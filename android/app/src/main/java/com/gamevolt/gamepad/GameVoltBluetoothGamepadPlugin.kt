package com.gamevolt.gamepad

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

/**
 * GameVoltBluetoothGamepadPlugin
 *
 * Production Native Android BluetoothHidDevice Capacitor Plugin ("GameVoltBluetoothGamepad")
 * for Game Volt Gamepad.
 *
 * Fixes & Architecture:
 * 1. Waits for asynchronous `onAppStatusChanged(registered = true)` before marking HID ready
 *    or starting Bluetooth discoverability, preventing SDP missing-service race conditions.
 * 2. Never calls `unregisterApp()` immediately before `registerApp()` on an active proxy.
 * 3. Uses `SUBCLASS1_NONE` and default L2CAP QoS (`inQos = null, outQos = null`) so Windows 10/11
 *    and Android TV hosts do not reject L2CAP Interrupt channel (PSM 0x0013) QoS negotiation.
 * 4. Resets HID Global Items (`Unit = 0`, `Physical Maximum = 0`) after the 4-bit Hat Switch
 *    in the 9-byte Report ID 1 HID Descriptor so Windows `hidparse.sys` and Android `hid-generic`
 *    parse all 4 analog thumbstick axes and 2 analog triggers accurately.
 * 5. Tracks full Pairing/Bonding (`BOND_NONE`, `BOND_BONDING`, `BOND_BONDED`) and HID Connection
 *    states (`DISCONNECTED`, `DISCOVERABLE`, `PAIRING`, `BONDED`, `CONNECTING`, `CONNECTED`)
 *    with a 15-second connection watchdog timer and detailed Logcat + UI callback history.
 */
@CapacitorPlugin(
    name = "GameVoltBluetoothGamepad",
    permissions = [
        Permission(
            alias = "bluetooth",
            strings = [
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN
            ]
        ),
        Permission(
            alias = "bluetooth12",
            strings = [
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE
            ]
        )
    ]
)
class GameVoltBluetoothGamepadPlugin : Plugin() {

    companion object {
        private const val TAG = "GameVoltBT_HID"
        const val CONTROLLER_BLUETOOTH_NAME = "Game Volt Gamepad"
        const val REPORT_ID: Int = 1
        private const val CONNECTION_TIMEOUT_MS = 15000L
        private const val MAX_CALLBACK_LOGS = 40
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    @Volatile private var hidDevice: BluetoothHidDevice? = null

    private val isProxyRequestInFlight = AtomicBoolean(false)
    private val isRegisterAppInFlight = AtomicBoolean(false)

    @Volatile private var isHidProfileAvailable: Boolean = false
    @Volatile private var isHidRegistered: Boolean = false
    @Volatile private var isDiscoverable: Boolean = false

    @Volatile private var connectedHost: BluetoothDevice? = null
    @Volatile private var activeTargetDevice: BluetoothDevice? = null
    @Volatile private var connectionStateStr: String = "DISCONNECTED"
    @Volatile private var pairingStatusStr: String = "NONE"
    @Volatile private var lastRegistrationCallbackMsg: String = "Not called yet"
    @Volatile private var lastErrorMsg: String? = null
    @Volatile private var lastConnectedHostAddress: String? = null
    @Volatile private var pendingConnectAfterBondAddress: String? = null

    private val pendingRegisterCalls = CopyOnWriteArrayList<PluginCall>()
    private val callbackHistory = CopyOnWriteArrayList<String>()
    private val reportsSentCounter = AtomicLong(0)
    @Volatile private var lastReportBytes = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)

    private val hidExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var connectionTimeoutRunnable: Runnable? = null

    /**
     * Standards-Compliant Universal Gamepad HID Report Descriptor (Report ID 1, 9 Bytes Payload):
     * - Byte 0: Buttons 1..8  (A, B, X, Y, LB, RB, LT-click, RT-click)
     * - Byte 1: Buttons 9..16 (View, Menu, L3, R3, Home + 3 bits constant padding)
     * - Byte 2: Low nibble = 8-way Hat Switch D-Pad (0=UP..7=UP_LEFT, 8=CENTER/Null)
     *           High nibble = 4-bit constant padding
     * - Byte 3: Left Stick X  (-127..+127)
     * - Byte 4: Left Stick Y  (-127..+127)
     * - Byte 5: Right Stick X (-127..+127)
     * - Byte 6: Right Stick Y (-127..+127)
     * - Byte 7: Left Trigger  (0..255)
     * - Byte 8: Right Trigger (0..255)
     */
    private val UNIVERSAL_GAMEPAD_HID_DESCRIPTOR = byteArrayOf(
        0x05.toByte(), 0x01.toByte(),       // Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x05.toByte(),       // Usage (Game Pad)
        0xA1.toByte(), 0x01.toByte(),       // Collection (Application)
        0x85.toByte(), REPORT_ID.toByte(),  //   Report ID (1)

        // 16 Buttons (2 Bytes: Byte 0 and Byte 1)
        0x05.toByte(), 0x09.toByte(),       //   Usage Page (Button)
        0x19.toByte(), 0x01.toByte(),       //   Usage Minimum (Button 1)
        0x29.toByte(), 0x10.toByte(),       //   Usage Maximum (Button 16)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x25.toByte(), 0x01.toByte(),       //   Logical Maximum (1)
        0x75.toByte(), 0x01.toByte(),       //   Report Size (1 bit)
        0x95.toByte(), 0x10.toByte(),       //   Report Count (16)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        // 8-Way Hat Switch D-Pad (1 Byte: 4 bits Hat + 4 bits Padding)
        0x05.toByte(), 0x01.toByte(),       //   Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x39.toByte(),       //   Usage (Hat switch)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x25.toByte(), 0x07.toByte(),       //   Logical Maximum (7)
        0x35.toByte(), 0x00.toByte(),       //   Physical Minimum (0)
        0x46.toByte(), 0x3B.toByte(), 0x01.toByte(), // Physical Maximum (315)
        0x65.toByte(), 0x14.toByte(),       //   Unit (Eng Rot:Angular Pos)
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4 bits)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x42.toByte(),       //   Input (Data,Var,Abs,Null)

        // Reset Global Unit & Physical bounds so following axes are not angular
        0x65.toByte(), 0x00.toByte(),       //   Unit (None)
        0x45.toByte(), 0x00.toByte(),       //   Physical Maximum (0)
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4 bits padding)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x01.toByte(),       //   Input (Const,Array,Abs)

        // 4 Analog Thumbstick Axes: X, Y, Z, Rz (4 Bytes, -127..+127)
        0x05.toByte(), 0x01.toByte(),       //   Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x30.toByte(),       //   Usage (X - Left Stick X)
        0x09.toByte(), 0x31.toByte(),       //   Usage (Y - Left Stick Y)
        0x09.toByte(), 0x32.toByte(),       //   Usage (Z - Right Stick X)
        0x09.toByte(), 0x35.toByte(),       //   Usage (Rz - Right Stick Y)
        0x15.toByte(), 0x81.toByte(),       //   Logical Minimum (-127)
        0x25.toByte(), 0x7F.toByte(),       //   Logical Maximum (+127)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8 bits)
        0x95.toByte(), 0x04.toByte(),       //   Report Count (4)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        // 2 Analog Triggers: Brake (LT) & Accelerator (RT) (2 Bytes, 0..255)
        0x05.toByte(), 0x02.toByte(),       //   Usage Page (Simulation Controls)
        0x09.toByte(), 0xC5.toByte(),       //   Usage (Brake - LT)
        0x09.toByte(), 0xC4.toByte(),       //   Usage (Accelerator - RT)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x26.toByte(), 0xFF.toByte(), 0x00.toByte(), // Logical Maximum (255)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8 bits)
        0x95.toByte(), 0x02.toByte(),       //   Report Count (2)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        0xC0.toByte()                       // End Collection
    )

    private fun appendCallbackLog(event: String, isError: Boolean = false) {
        val timestamp = SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(Date())
        val line = "[$timestamp] $event"
        if (isError) {
            Log.e(TAG, event)
            lastErrorMsg = event
        } else {
            Log.i(TAG, event)
        }
        callbackHistory.add(0, line)
        while (callbackHistory.size > MAX_CALLBACK_LOGS) {
            callbackHistory.removeAt(callbackHistory.size - 1)
        }
    }

    private val bluetoothReceiver = object : BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                BluetoothAdapter.ACTION_SCAN_MODE_CHANGED -> {
                    val mode = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_SCAN_MODE,
                        BluetoothAdapter.SCAN_MODE_NONE
                    )
                    val prevDiscoverable = isDiscoverable
                    isDiscoverable = (mode == BluetoothAdapter.SCAN_MODE_CONNECTABLE_DISCOVERABLE)
                    if (isDiscoverable != prevDiscoverable) {
                        appendCallbackLog(
                            "ScanModeChanged: discoverable=$isDiscoverable (mode=$mode)"
                        )
                    }
                    emitStatusUpdate(null)
                }

                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_STATE,
                        BluetoothAdapter.ERROR
                    )
                    when (state) {
                        BluetoothAdapter.STATE_OFF, BluetoothAdapter.STATE_TURNING_OFF -> {
                            cancelConnectionWatchdog()
                            connectedHost = null
                            activeTargetDevice = null
                            connectionStateStr = "DISCONNECTED"
                            pairingStatusStr = "NONE"
                            isHidRegistered = false
                            isDiscoverable = false
                            isRegisterAppInFlight.set(false)
                            appendCallbackLog("Bluetooth adapter turned OFF", isError = true)
                            emitStatusUpdate("Bluetooth adapter is turned off.")
                        }
                        BluetoothAdapter.STATE_ON -> {
                            appendCallbackLog("Bluetooth adapter turned ON")
                            emitStatusUpdate(null)
                        }
                    }
                }

                BluetoothDevice.ACTION_PAIRING_REQUEST -> {
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    val variant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT, -1)
                    activeTargetDevice = device
                    pairingStatusStr = "PAIRING"
                    if (connectionStateStr != "CONNECTED") {
                        connectionStateStr = "PAIRING"
                    }
                    appendCallbackLog(
                        "Pairing request from ${safeDeviceName(device)} [${device?.address ?: "unknown"}] (variant=$variant)"
                    )
                    emitStatusUpdate(null)
                }

                BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
                    val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    }
                    val bondState = intent.getIntExtra(
                        BluetoothDevice.EXTRA_BOND_STATE,
                        BluetoothDevice.BOND_NONE
                    )
                    val prevBondState = intent.getIntExtra(
                        BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE,
                        BluetoothDevice.BOND_NONE
                    )

                    if (device != null) {
                        activeTargetDevice = device
                    }

                    when (bondState) {
                        BluetoothDevice.BOND_BONDING -> {
                            pairingStatusStr = "PAIRING"
                            if (connectionStateStr != "CONNECTED") {
                                connectionStateStr = "PAIRING"
                            }
                            appendCallbackLog(
                                "BondStateChanged: ${safeDeviceName(device)} [${device?.address}] BOND_BONDING"
                            )
                        }
                        BluetoothDevice.BOND_BONDED -> {
                            pairingStatusStr = "BONDED"
                            if (connectionStateStr != "CONNECTED" && connectionStateStr != "CONNECTING") {
                                connectionStateStr = "BONDED"
                            }
                            appendCallbackLog(
                                "BondStateChanged: ${safeDeviceName(device)} [${device?.address}] BOND_BONDED (prev=$prevBondState)"
                            )
                            // If this bond completed from a user-initiated or host-initiated pairing,
                            // wait 1200ms to allow host-initiated L2CAP HID open; if still not connected,
                            // initiate HID connection from the peripheral side.
                            if (device != null) {
                                val bondedAddr = device.address
                                lastConnectedHostAddress = bondedAddr
                                mainHandler.postDelayed({
                                    autoConnectAfterBondIfNeeded(device)
                                }, 1200L)
                            }
                        }
                        BluetoothDevice.BOND_NONE -> {
                            pairingStatusStr = "NONE"
                            if (connectedHost?.address == device?.address) {
                                connectedHost = null
                                connectionStateStr = "DISCONNECTED"
                            } else if (connectionStateStr == "PAIRING" || connectionStateStr == "BONDED") {
                                connectionStateStr = "DISCONNECTED"
                            }
                            val failReason = if (prevBondState == BluetoothDevice.BOND_BONDING) {
                                "Pairing with ${safeDeviceName(device)} [${device?.address}] failed or was rejected by host."
                            } else {
                                "Bond removed for ${safeDeviceName(device)} [${device?.address}]."
                            }
                            appendCallbackLog(failReason, isError = (prevBondState == BluetoothDevice.BOND_BONDING))
                        }
                    }
                    emitStatusUpdate(null)
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun autoConnectAfterBondIfNeeded(device: BluetoothDevice) {
        val hid = hidDevice ?: return
        if (!isHidRegistered || !hasBluetoothConnectPermission()) return
        val currentHidState = try {
            hid.getConnectionState(device)
        } catch (_: Exception) {
            BluetoothProfile.STATE_DISCONNECTED
        }
        if (currentHidState == BluetoothProfile.STATE_CONNECTED ||
            currentHidState == BluetoothProfile.STATE_CONNECTING
        ) {
            appendCallbackLog(
                "Post-bond check: Host ${safeDeviceName(device)} [${device.address}] already in HID state $currentHidState"
            )
            return
        }
        if (pendingConnectAfterBondAddress == device.address || connectedHost == null) {
            pendingConnectAfterBondAddress = null
            appendCallbackLog(
                "Initiating HID L2CAP connection to newly bonded host ${safeDeviceName(device)} [${device.address}]"
            )
            connectionStateStr = "CONNECTING"
            startConnectionWatchdog(device)
            val ok = try {
                hid.connect(device)
            } catch (e: Exception) {
                appendCallbackLog("hid.connect exception after bond: ${e.message}", isError = true)
                false
            }
            if (!ok) {
                cancelConnectionWatchdog()
                connectionStateStr = "BONDED"
                appendCallbackLog(
                    "hid.connect(${device.address}) returned false after bonding; waiting for host to initiate HID channel."
                )
            }
            emitStatusUpdate(null)
        }
    }

    override fun load() {
        super.load()
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter

        val filter = IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_SCAN_MODE_CHANGED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED)
            addAction(BluetoothDevice.ACTION_PAIRING_REQUEST)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(bluetoothReceiver, filter)
        }
        appendCallbackLog("GameVoltBluetoothGamepadPlugin loaded (SDK=${Build.VERSION.SDK_INT})")
    }

    @SuppressLint("MissingPermission")
    override fun handleOnDestroy() {
        cancelConnectionWatchdog()
        try {
            sendZeroFailsafeReportInternal()
            hidDevice?.unregisterApp()
            bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, hidDevice)
            context.unregisterReceiver(bluetoothReceiver)
        } catch (_: Exception) {
        }
        super.handleOnDestroy()
    }

    private fun hasBluetoothConnectPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_CONNECT
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun hasBluetoothAdvertisePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_ADVERTISE
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun hasBluetoothScanPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.BLUETOOTH_SCAN
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    @SuppressLint("MissingPermission")
    private fun safeDeviceName(device: BluetoothDevice?): String {
        if (device == null) return "Unknown Host"
        return try {
            if (hasBluetoothConnectPermission()) {
                device.name ?: device.address ?: "Unknown Host"
            } else {
                device.address ?: "Unknown Host"
            }
        } catch (_: Exception) {
            device.address ?: "Unknown Host"
        }
    }

    private fun startConnectionWatchdog(target: BluetoothDevice) {
        cancelConnectionWatchdog()
        val runnable = Runnable {
            if (connectionStateStr == "CONNECTING") {
                connectionStateStr = if (
                    hasBluetoothConnectPermission() &&
                    target.bondState == BluetoothDevice.BOND_BONDED
                ) {
                    "BONDED"
                } else {
                    "DISCONNECTED"
                }
                val timeoutMsg =
                    "HID connection to ${safeDeviceName(target)} [${target.address}] timed out after ${CONNECTION_TIMEOUT_MS / 1000}s. If you previously paired this phone, remove/forget 'Game Volt Gamepad' on the host and pair again."
                appendCallbackLog(timeoutMsg, isError = true)
                emitStatusUpdate(timeoutMsg)
            }
        }
        connectionTimeoutRunnable = runnable
        mainHandler.postDelayed(runnable, CONNECTION_TIMEOUT_MS)
    }

    private fun cancelConnectionWatchdog() {
        connectionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        connectionTimeoutRunnable = null
    }

    /**
     * Single persistent BluetoothHidDevice.Callback instance.
     */
    private val hidCallback = object : BluetoothHidDevice.Callback() {
        @SuppressLint("MissingPermission")
        override fun onAppStatusChanged(
            pluggedDevice: BluetoothDevice?,
            registered: Boolean
        ) {
            isRegisterAppInFlight.set(false)
            isHidRegistered = registered
            val pluggedInfo = if (pluggedDevice != null) {
                "${safeDeviceName(pluggedDevice)} [${pluggedDevice.address}]"
            } else {
                "none"
            }
            lastRegistrationCallbackMsg =
                "onAppStatusChanged(registered=$registered, pluggedDevice=$pluggedInfo)"
            appendCallbackLog(lastRegistrationCallbackMsg, isError = !registered)

            if (registered) {
                lastErrorMsg = null
                if (pluggedDevice != null) {
                    activeTargetDevice = pluggedDevice
                    lastConnectedHostAddress = pluggedDevice.address
                    if (pluggedDevice.bondState == BluetoothDevice.BOND_BONDED) {
                        pairingStatusStr = "BONDED"
                    }
                    val hid = hidDevice
                    if (hid != null &&
                        hid.getConnectionState(pluggedDevice) == BluetoothProfile.STATE_CONNECTED
                    ) {
                        connectedHost = pluggedDevice
                        connectionStateStr = "CONNECTED"
                        appendCallbackLog("Already connected to pluggedDevice $pluggedInfo")
                    }
                }
            } else {
                connectedHost = null
                connectionStateStr = "DISCONNECTED"
            }

            // Resolve any pending registerGamepad PluginCalls waiting for actual registration callback
            val callsToResolve = ArrayList(pendingRegisterCalls)
            pendingRegisterCalls.clear()
            val err = if (registered) {
                null
            } else {
                "BluetoothHidDevice.Callback.onAppStatusChanged reported registered=false."
            }
            for (pendingCall in callsToResolve) {
                pendingCall.resolve(buildFullStatusObject(err))
            }

            emitStatusUpdate(err)
        }

        @SuppressLint("MissingPermission")
        override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
            activeTargetDevice = device
            if (hasBluetoothConnectPermission() && device.bondState == BluetoothDevice.BOND_BONDED) {
                pairingStatusStr = "BONDED"
            }

            when (state) {
                BluetoothProfile.STATE_CONNECTED -> {
                    cancelConnectionWatchdog()
                    connectedHost = device
                    lastConnectedHostAddress = device.address
                    connectionStateStr = "CONNECTED"
                    pairingStatusStr = "BONDED"
                    lastErrorMsg = null
                    appendCallbackLog(
                        "onConnectionStateChanged: CONNECTED to ${safeDeviceName(device)} [${device.address}]"
                    )
                    // Send initial neutral report after 150ms so host L2CAP interrupt channel is ready
                    mainHandler.postDelayed({
                        sendZeroFailsafeReportInternal()
                    }, 150L)
                    emitStatusUpdate(null)
                }

                BluetoothProfile.STATE_CONNECTING -> {
                    connectionStateStr = "CONNECTING"
                    appendCallbackLog(
                        "onConnectionStateChanged: CONNECTING to ${safeDeviceName(device)} [${device.address}]"
                    )
                    startConnectionWatchdog(device)
                    emitStatusUpdate(null)
                }

                BluetoothProfile.STATE_DISCONNECTING -> {
                    connectionStateStr = "DISCONNECTING"
                    appendCallbackLog(
                        "onConnectionStateChanged: DISCONNECTING from ${safeDeviceName(device)} [${device.address}]"
                    )
                    emitStatusUpdate(null)
                }

                BluetoothProfile.STATE_DISCONNECTED -> {
                    val wasConnecting = (connectionStateStr == "CONNECTING")
                    val wasConnected = (connectedHost?.address == device.address)
                    cancelConnectionWatchdog()

                    if (connectedHost?.address == device.address) {
                        connectedHost = null
                    }
                    lastReportBytes = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)

                    val isBonded = hasBluetoothConnectPermission() &&
                        device.bondState == BluetoothDevice.BOND_BONDED
                    connectionStateStr = if (isBonded) "BONDED" else "DISCONNECTED"

                    if (wasConnecting) {
                        val rejectMsg =
                            "Host ${safeDeviceName(device)} [${device.address}] closed or rejected the HID connection attempt. Remove 'Game Volt Gamepad' from the host's Bluetooth list and pair again."
                        appendCallbackLog(rejectMsg, isError = true)
                        emitStatusUpdate(rejectMsg)
                    } else {
                        appendCallbackLog(
                            "onConnectionStateChanged: DISCONNECTED from ${safeDeviceName(device)} [${device.address}] (wasConnected=$wasConnected)"
                        )
                        emitStatusUpdate(null)
                    }
                }
            }
        }

        @SuppressLint("MissingPermission")
        override fun onGetReport(
            device: BluetoothDevice?,
            type: Byte,
            id: Byte,
            bufferSize: Int
        ) {
            val hid = hidDevice ?: return
            if (device == null) return
            Log.d(TAG, "onGetReport from ${device.address}: type=$type id=$id bufferSize=$bufferSize")

            if (type == BluetoothHidDevice.REPORT_TYPE_INPUT) {
                if (id != 0.toByte() && id != REPORT_ID.toByte()) {
                    hid.reportError(device, BluetoothHidDevice.ERROR_RSP_INVALID_RPT_ID)
                } else {
                    hid.replyReport(
                        device,
                        BluetoothHidDevice.REPORT_TYPE_INPUT,
                        REPORT_ID.toByte(),
                        lastReportBytes
                    )
                }
            } else {
                hid.reportError(device, BluetoothHidDevice.ERROR_RSP_INVALID_PARAM)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onSetReport(
            device: BluetoothDevice?,
            type: Byte,
            id: Byte,
            data: ByteArray?
        ) {
            Log.d(TAG, "onSetReport from ${device?.address}: type=$type id=$id len=${data?.size ?: 0}")
            if (device != null) {
                hidDevice?.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS)
            }
        }

        @SuppressLint("MissingPermission")
        override fun onSetProtocol(device: BluetoothDevice?, protocol: Byte) {
            appendCallbackLog("onSetProtocol from ${device?.address}: protocol=$protocol")
        }

        @SuppressLint("MissingPermission")
        override fun onInterruptData(device: BluetoothDevice?, reportId: Byte, data: ByteArray?) {
            Log.d(TAG, "onInterruptData from ${device?.address}: reportId=$reportId")
        }

        @SuppressLint("MissingPermission")
        override fun onVirtualCableUnplug(device: BluetoothDevice?) {
            cancelConnectionWatchdog()
            if (connectedHost?.address == device?.address) {
                connectedHost = null
            }
            connectionStateStr = "DISCONNECTED"
            appendCallbackLog("onVirtualCableUnplug from ${safeDeviceName(device)} [${device?.address}]")
            emitStatusUpdate(null)
        }
    }

    /**
     * 1. Core Interface Method: registerGamepad
     * Obtains BluetoothProfile.HID_DEVICE proxy and registers the SDP + HID descriptor.
     * Waits for the real `onAppStatusChanged` callback before resolving.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun registerGamepad(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            val msg = "BluetoothHidDevice requires Android 9.0 (API 28) or higher."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        val adapter = bluetoothAdapter
        if (adapter == null) {
            val msg = "No hardware Bluetooth adapter found on this Android device."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        if (!adapter.isEnabled) {
            val msg = "Bluetooth is disabled. Turn on Bluetooth in Android Settings."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        if (!hasBluetoothConnectPermission() || !hasBluetoothAdvertisePermission()) {
            appendCallbackLog("Requesting runtime Bluetooth permissions (CONNECT / SCAN / ADVERTISE)...")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAlias("bluetooth12", call, "registerGamepadPermsCallback")
            } else {
                requestPermissionForAlias("bluetooth", call, "registerGamepadPermsCallback")
            }
            return
        }

        ensureHidRegisteredAsync(call)
    }

    @PermissionCallback
    private fun registerGamepadPermsCallback(call: PluginCall) {
        if (hasBluetoothConnectPermission()) {
            appendCallbackLog("Bluetooth runtime permissions granted by user.")
            ensureHidRegisteredAsync(call)
        } else {
            val msg = "Bluetooth runtime permissions (BLUETOOTH_CONNECT / BLUETOOTH_ADVERTISE) were denied."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
        }
    }

    @SuppressLint("MissingPermission")
    private fun ensureHidRegisteredAsync(call: PluginCall) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            call.resolve(buildFullStatusObject("Bluetooth adapter is disabled."))
            return
        }

        try {
            adapter.name = CONTROLLER_BLUETOOTH_NAME
        } catch (e: Exception) {
            Log.w(TAG, "Unable to set Bluetooth adapter name: ${e.message}")
        }

        // If already registered with an active proxy, verify connected devices and return immediately
        val existingHid = hidDevice
        if (existingHid != null && isHidRegistered) {
            syncExistingConnectedDevices(existingHid)
            call.resolve(buildFullStatusObject(null))
            return
        }

        pendingRegisterCalls.add(call)

        // Timeout fallback so a PluginCall never hangs if OS drops binder callback
        mainHandler.postDelayed({
            if (pendingRegisterCalls.remove(call)) {
                val timeoutErr = if (isHidRegistered) {
                    null
                } else {
                    "Timed out waiting for BluetoothHidDevice onAppStatusChanged callback."
                }
                if (timeoutErr != null) {
                    appendCallbackLog(timeoutErr, isError = true)
                }
                call.resolve(buildFullStatusObject(timeoutErr))
            }
        }, 6000L)

        if (existingHid != null) {
            registerHidAppWithProxy(existingHid)
            return
        }

        if (!isProxyRequestInFlight.compareAndSet(false, true)) {
            appendCallbackLog("BluetoothProfile.HID_DEVICE proxy request already in flight...")
            return
        }

        val serviceListener = object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                if (profile != BluetoothProfile.HID_DEVICE) return
                isProxyRequestInFlight.set(false)
                isHidProfileAvailable = true
                val hid = proxy as BluetoothHidDevice
                hidDevice = hid
                appendCallbackLog("BluetoothProfile.HID_DEVICE service proxy connected.")
                registerHidAppWithProxy(hid)
            }

            override fun onServiceDisconnected(profile: Int) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    isProxyRequestInFlight.set(false)
                    isRegisterAppInFlight.set(false)
                    hidDevice = null
                    isHidRegistered = false
                    connectedHost = null
                    connectionStateStr = "DISCONNECTED"
                    appendCallbackLog("BluetoothProfile.HID_DEVICE service proxy disconnected.", isError = true)
                    emitStatusUpdate("Bluetooth HID system service disconnected.")
                }
            }
        }

        appendCallbackLog("Requesting BluetoothProfile.HID_DEVICE profile proxy...")
        val profileOpened = adapter.getProfileProxy(
            context,
            serviceListener,
            BluetoothProfile.HID_DEVICE
        )
        if (!profileOpened) {
            isProxyRequestInFlight.set(false)
            isHidProfileAvailable = false
            val msg = "BluetoothProfile.HID_DEVICE is not supported or blocked on this Android device."
            appendCallbackLog(msg, isError = true)
            val calls = ArrayList(pendingRegisterCalls)
            pendingRegisterCalls.clear()
            for (c in calls) {
                c.resolve(buildFullStatusObject(msg))
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun registerHidAppWithProxy(hid: BluetoothHidDevice) {
        if (isHidRegistered) {
            val calls = ArrayList(pendingRegisterCalls)
            pendingRegisterCalls.clear()
            for (c in calls) {
                c.resolve(buildFullStatusObject(null))
            }
            return
        }
        if (!isRegisterAppInFlight.compareAndSet(false, true)) {
            appendCallbackLog("registerApp() already in progress; waiting for callback...")
            return
        }

        // Use SUBCLASS1_NONE and null inQos/outQos for maximum L2CAP compatibility with Windows 10/11 & Android TV
        val sdpSettings = BluetoothHidDeviceAppSdpSettings(
            CONTROLLER_BLUETOOTH_NAME,
            "Game Volt Wireless Bluetooth HID Game Controller",
            "Game Volt",
            BluetoothHidDevice.SUBCLASS1_NONE,
            UNIVERSAL_GAMEPAD_HID_DESCRIPTOR
        )

        appendCallbackLog(
            "Calling BluetoothHidDevice.registerApp (descriptor=${UNIVERSAL_GAMEPAD_HID_DESCRIPTOR.size} bytes, ReportID=$REPORT_ID)..."
        )
        val regQueued = try {
            hid.registerApp(sdpSettings, null, null, hidExecutor, hidCallback)
        } catch (e: Exception) {
            appendCallbackLog("registerApp threw exception: ${e.message}", isError = true)
            false
        }

        if (!regQueued) {
            isRegisterAppInFlight.set(false)
            val msg =
                "BluetoothHidDevice.registerApp() returned false. Close any other controller apps using Bluetooth HID and toggle Bluetooth off/on."
            appendCallbackLog(msg, isError = true)
            val calls = ArrayList(pendingRegisterCalls)
            pendingRegisterCalls.clear()
            for (c in calls) {
                c.resolve(buildFullStatusObject(msg))
            }
            emitStatusUpdate(msg)
        }
    }

    @SuppressLint("MissingPermission")
    private fun syncExistingConnectedDevices(hid: BluetoothHidDevice) {
        if (!hasBluetoothConnectPermission()) return
        try {
            val connectedList = hid.connectedDevices
            if (!connectedList.isNullOrEmpty()) {
                val host = connectedList[0]
                connectedHost = host
                activeTargetDevice = host
                lastConnectedHostAddress = host.address
                connectionStateStr = "CONNECTED"
                pairingStatusStr = "BONDED"
            }
        } catch (_: Exception) {
        }
    }

    /**
     * 2. Core Interface Method: sendHidReport
     * Encodes and transmits the 9-byte Bluetooth HID Gamepad input report to the connected host.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun sendHidReport(call: PluginCall) {
        val buttonsMask = call.getInt("buttonsMask", 0) ?: 0
        val hat = call.getInt("hat", 8) ?: 8

        val lxFloat = call.getDouble("leftX", 0.0) ?: 0.0
        val lyFloat = call.getDouble("leftY", 0.0) ?: 0.0
        val rxFloat = call.getDouble("rightX", 0.0) ?: 0.0
        val ryFloat = call.getDouble("rightY", 0.0) ?: 0.0
        val ltFloat = call.getDouble("lt", 0.0) ?: 0.0
        val rtFloat = call.getDouble("rt", 0.0) ?: 0.0

        val lxByte = (lxFloat * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val lyByte = (lyFloat * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val rxByte = (rxFloat * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val ryByte = (ryFloat * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val ltByte = (ltFloat * 255.0).roundToInt().coerceIn(0, 255).toByte()
        val rtByte = (rtFloat * 255.0).roundToInt().coerceIn(0, 255).toByte()

        val report = byteArrayOf(
            (buttonsMask and 0xFF).toByte(),
            ((buttonsMask shr 8) and 0xFF).toByte(),
            (hat and 0x0F).toByte(),
            lxByte,
            lyByte,
            rxByte,
            ryByte,
            ltByte,
            rtByte
        )

        lastReportBytes = report
        val hexStr = formatHex(report)

        val hid = hidDevice
        val host = connectedHost
        if (hid == null || host == null || !isHidRegistered || connectionStateStr != "CONNECTED") {
            val ret = JSObject().apply {
                put("sent", false)
                put("reportHex", hexStr)
            }
            call.resolve(ret)
            return
        }

        val sent = try {
            hid.sendReport(host, REPORT_ID, report)
        } catch (e: Exception) {
            Log.e(TAG, "sendReport exception: ${e.message}")
            false
        }
        if (sent) {
            val count = reportsSentCounter.incrementAndGet()
            if (count == 1L || count % 100L == 0L) {
                Log.d(TAG, "Sent HID report #$count to ${host.address}: [$hexStr]")
            }
        } else {
            Log.w(TAG, "hid.sendReport returned false for ${host.address}: [$hexStr]")
        }

        val ret = JSObject().apply {
            put("sent", sent)
            put("reportHex", hexStr)
        }
        call.resolve(ret)
    }

    /**
     * 3. Core Interface Method: disconnect
     * Sends a failsafe zero report to release all buttons/axes and disconnects from the active Bluetooth HID host.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun disconnect(call: PluginCall) {
        cancelConnectionWatchdog()
        val hid = hidDevice
        val host = connectedHost ?: activeTargetDevice
        sendZeroFailsafeReportInternal()
        if (hid != null && host != null && hasBluetoothConnectPermission()) {
            try {
                appendCallbackLog("Disconnecting from host ${safeDeviceName(host)} [${host.address}]...")
                hid.disconnect(host)
            } catch (e: Exception) {
                appendCallbackLog("Error disconnecting host: ${e.message}", isError = true)
            }
        }
        connectedHost = null
        connectionStateStr = "DISCONNECTED"
        call.resolve(buildFullStatusObject(null))
    }

    @PluginMethod
    fun registerHidDevice(call: PluginCall) {
        registerGamepad(call)
    }

    @PluginMethod
    fun disconnectHost(call: PluginCall) {
        disconnect(call)
    }

    @PluginMethod
    fun checkCompatibility(call: PluginCall) {
        val sdkInt = Build.VERSION.SDK_INT
        val supportedApi = sdkInt >= Build.VERSION_CODES.P
        val hasBluetoothHardware = bluetoothAdapter != null
        val isEnabled = bluetoothAdapter?.isEnabled == true
        val permissionsGranted = hasBluetoothConnectPermission() && hasBluetoothAdvertisePermission()

        val limitation: String? = when {
            !hasBluetoothHardware -> "This Android device does not have a hardware Bluetooth adapter."
            !supportedApi -> "Android ${Build.VERSION.RELEASE} (API $sdkInt) detected. BluetoothHidDevice requires Android 9.0 (API 28) or higher."
            !isEnabled -> "Bluetooth is currently turned off. Enable Bluetooth to register Game Volt Gamepad."
            !permissionsGranted -> "Bluetooth permissions (BLUETOOTH_CONNECT / BLUETOOTH_ADVERTISE) are required."
            else -> null
        }

        val ret = JSObject().apply {
            put("platform", "android")
            put("isNativeAndroidApk", true)
            put("androidSdkInt", sdkInt)
            put("androidRelease", Build.VERSION.RELEASE ?: "Unknown")
            put("deviceModel", "${Build.MANUFACTURER} ${Build.MODEL}")
            put("bluetoothSupported", hasBluetoothHardware)
            put("bluetoothEnabled", isEnabled)
            put("hidProfileSupported", supportedApi && hasBluetoothHardware)
            put("permissionsGranted", permissionsGranted)
            put("hidRegistered", isHidRegistered)
            put("discoverable", isDiscoverable)
            put("controllerName", CONTROLLER_BLUETOOTH_NAME)
            put(
                "statusMessage",
                limitation ?: "Native Android BluetoothHidDevice is supported and ready."
            )
            put("limitationReason", limitation)
        }
        call.resolve(ret)
    }

    @PluginMethod
    fun requestBluetoothPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (getPermissionState("bluetooth12") != PermissionState.GRANTED) {
                requestPermissionForAlias("bluetooth12", call, "bluetoothPermsCallback")
                return
            }
        } else {
            if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
                requestPermissionForAlias("bluetooth", call, "bluetoothPermsCallback")
                return
            }
        }
        val ret = JSObject().apply {
            put("granted", true)
            put("status", buildFullStatusObject(null))
        }
        call.resolve(ret)
    }

    @PermissionCallback
    private fun bluetoothPermsCallback(call: PluginCall) {
        val granted = hasBluetoothConnectPermission()
        val msg = if (granted) {
            null
        } else {
            "Bluetooth runtime permissions were denied. Please grant Nearby Devices / Bluetooth permission in Android Settings."
        }
        if (msg != null) {
            appendCallbackLog(msg, isError = true)
        }
        val ret = JSObject().apply {
            put("granted", granted)
            put("status", buildFullStatusObject(msg))
        }
        call.resolve(ret)
    }

    /**
     * Ensures HID application is registered BEFORE launching Bluetooth discoverable mode.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun startPairing(call: PluginCall) {
        if (!hasBluetoothConnectPermission() || !hasBluetoothAdvertisePermission()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAlias("bluetooth12", call, "startPairingPermsCallback")
            } else {
                requestPermissionForAlias("bluetooth", call, "startPairingPermsCallback")
            }
            return
        }

        if (!isHidRegistered) {
            appendCallbackLog("startPairing requested before HID registered; registering HID first...")
            val hid = hidDevice
            if (hid != null) {
                registerHidAppWithProxy(hid)
            }
        }

        launchDiscoverableIntent(call)
    }

    @PermissionCallback
    private fun startPairingPermsCallback(call: PluginCall) {
        if (!hasBluetoothConnectPermission() || !hasBluetoothAdvertisePermission()) {
            val msg = "Bluetooth Connect & Advertise permissions are required to make Game Volt Gamepad discoverable."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        launchDiscoverableIntent(call)
    }

    @SuppressLint("MissingPermission")
    private fun launchDiscoverableIntent(call: PluginCall) {
        try {
            bluetoothAdapter?.name = CONTROLLER_BLUETOOTH_NAME
        } catch (_: Exception) {
        }

        val duration = call.getInt("durationSeconds", 300) ?: 300
        try {
            val discoverableIntent = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).apply {
                putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, duration)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(discoverableIntent)
            appendCallbackLog(
                "Requested Bluetooth discoverability as '$CONTROLLER_BLUETOOTH_NAME' for ${duration}s"
            )
            call.resolve(buildFullStatusObject(null))
        } catch (e: Exception) {
            val msg = "Failed to start Bluetooth discoverability dialog: ${e.message}"
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
        }
    }

    @PluginMethod
    fun openBluetoothSettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("Unable to open Bluetooth settings: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        val hid = hidDevice
        if (hid != null && isHidRegistered) {
            syncExistingConnectedDevices(hid)
        }
        call.resolve(buildFullStatusObject(null))
    }

    /**
     * Initiates a genuine Bluetooth HID connection to a target host MAC address.
     * Handles unbonded devices (initiates bonding first), prevents duplicate connection calls,
     * and sets a 15-second connection watchdog timer.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connectHost(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.resolve(buildFullStatusObject("Missing target Bluetooth MAC address."))
            return
        }
        if (!hasBluetoothConnectPermission()) {
            val msg = "Bluetooth Connect permission not granted."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        val hid = hidDevice
        if (hid == null || !isHidRegistered) {
            val msg = "HID profile is not registered yet. Tap 'Register Gamepad' first."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }

        val device = try {
            bluetoothAdapter?.getRemoteDevice(address)
        } catch (_: IllegalArgumentException) {
            null
        }
        if (device == null) {
            val msg = "Invalid Bluetooth MAC address: $address"
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }

        activeTargetDevice = device
        lastConnectedHostAddress = address

        val existingState = try {
            hid.getConnectionState(device)
        } catch (_: Exception) {
            BluetoothProfile.STATE_DISCONNECTED
        }

        if (existingState == BluetoothProfile.STATE_CONNECTED) {
            connectedHost = device
            connectionStateStr = "CONNECTED"
            pairingStatusStr = "BONDED"
            appendCallbackLog("Host ${safeDeviceName(device)} [$address] is already CONNECTED.")
            call.resolve(buildFullStatusObject(null))
            return
        }

        if (existingState == BluetoothProfile.STATE_CONNECTING || connectionStateStr == "CONNECTING") {
            appendCallbackLog(
                "Connection attempt to ${safeDeviceName(device)} [$address] is already in progress."
            )
            call.resolve(buildFullStatusObject(null))
            return
        }

        // Check bond state before calling hid.connect(device)
        when (device.bondState) {
            BluetoothDevice.BOND_NONE -> {
                pendingConnectAfterBondAddress = address
                pairingStatusStr = "PAIRING"
                connectionStateStr = "PAIRING"
                appendCallbackLog(
                    "Host ${safeDeviceName(device)} [$address] is unbonded; calling createBond() first..."
                )
                val bondStarted = device.createBond()
                if (!bondStarted) {
                    connectionStateStr = "DISCONNECTED"
                    pairingStatusStr = "NONE"
                    val msg = "Could not start Bluetooth bonding with ${safeDeviceName(device)} [$address]."
                    appendCallbackLog(msg, isError = true)
                    call.resolve(buildFullStatusObject(msg))
                    return
                }
                call.resolve(buildFullStatusObject(null))
                return
            }

            BluetoothDevice.BOND_BONDING -> {
                pendingConnectAfterBondAddress = address
                pairingStatusStr = "PAIRING"
                connectionStateStr = "PAIRING"
                appendCallbackLog("Host ${safeDeviceName(device)} [$address] is currently bonding; will connect once bonded.")
                call.resolve(buildFullStatusObject(null))
                return
            }

            BluetoothDevice.BOND_BONDED -> {
                pairingStatusStr = "BONDED"
                connectionStateStr = "CONNECTING"
                appendCallbackLog("Calling BluetoothHidDevice.connect(${safeDeviceName(device)} [$address])...")
                startConnectionWatchdog(device)
                val initiated = try {
                    hid.connect(device)
                } catch (e: Exception) {
                    appendCallbackLog("hid.connect threw exception: ${e.message}", isError = true)
                    false
                }
                if (!initiated) {
                    cancelConnectionWatchdog()
                    connectionStateStr = "BONDED"
                    val msg =
                        "BluetoothHidDevice.connect(${safeDeviceName(device)}) returned false. Make sure Bluetooth is open on the host and no other HID app is active."
                    appendCallbackLog(msg, isError = true)
                    call.resolve(buildFullStatusObject(msg))
                    return
                }
                call.resolve(buildFullStatusObject(null))
            }
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun reconnectLastHost(call: PluginCall) {
        val hid = hidDevice
        if (hid == null || !isHidRegistered) {
            val msg = "HID profile not registered yet. Tap 'Register Gamepad' first."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }
        if (!hasBluetoothConnectPermission()) {
            val msg = "Bluetooth Connect permission not granted."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }

        val targetAddr = lastConnectedHostAddress
            ?: bluetoothAdapter?.bondedDevices?.firstOrNull()?.address

        if (targetAddr == null) {
            val msg = "No previously paired Bluetooth host found. Pair your PC or TV first."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(targetAddr)
        if (device != null) {
            activeTargetDevice = device
            pairingStatusStr = if (device.bondState == BluetoothDevice.BOND_BONDED) "BONDED" else "NONE"
            connectionStateStr = "CONNECTING"
            appendCallbackLog("Reconnecting to ${safeDeviceName(device)} [$targetAddr]...")
            startConnectionWatchdog(device)
            val ok = hid.connect(device)
            if (!ok) {
                cancelConnectionWatchdog()
                connectionStateStr = if (device.bondState == BluetoothDevice.BOND_BONDED) "BONDED" else "DISCONNECTED"
                val msg = "Failed to initiate reconnection to ${safeDeviceName(device)} [$targetAddr]."
                appendCallbackLog(msg, isError = true)
                call.resolve(buildFullStatusObject(msg))
                return
            }
            call.resolve(buildFullStatusObject(null))
        } else {
            val msg = "Unable to locate Bluetooth host $targetAddr."
            appendCallbackLog(msg, isError = true)
            call.resolve(buildFullStatusObject(msg))
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun forgetDevice(call: PluginCall) {
        val address = call.getString("address")
        if (!address.isNullOrBlank() && hasBluetoothConnectPermission()) {
            val device = bluetoothAdapter?.getRemoteDevice(address)
            if (device != null) {
                try {
                    if (connectedHost?.address == address) {
                        sendZeroFailsafeReportInternal()
                        hidDevice?.disconnect(device)
                        connectedHost = null
                        connectionStateStr = "DISCONNECTED"
                    }
                    val removeBondMethod = device.javaClass.getMethod("removeBond")
                    removeBondMethod.invoke(device)
                    appendCallbackLog("Removed bond for ${safeDeviceName(device)} [$address]")
                } catch (e: Exception) {
                    appendCallbackLog("removeBond failed for $address: ${e.message}", isError = true)
                }
            }
        }
        call.resolve(buildFullStatusObject(null))
    }

    @PluginMethod
    fun releaseAllInputs(call: PluginCall) {
        val sent = sendZeroFailsafeReportInternal()
        val ret = JSObject().apply {
            put("sent", sent)
        }
        call.resolve(ret)
    }

    /**
     * Runs an end-to-end diagnostic self-test verifying:
     * 1. Bluetooth Adapter & Permissions
     * 2. BluetoothHidDevice Profile Proxy
     * 3. HID App Registration & Descriptor Validation (67 bytes, Report ID 1 -> 9-byte input report)
     * 4. Host Bonding & Real L2CAP HID Connection State
     * 5. Live Neutral HID Input Report Transmission Test
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun runDiagnosticTest(call: PluginCall) {
        val steps = JSArray()
        val adapter = bluetoothAdapter
        val adapterOk = adapter != null && adapter.isEnabled
        steps.put(
            JSObject().apply {
                put("step", "1. Bluetooth Adapter")
                put("passed", adapterOk)
                put(
                    "detail",
                    if (adapterOk) "Adapter enabled (Name: ${adapter?.name ?: CONTROLLER_BLUETOOTH_NAME})"
                    else "Bluetooth adapter is disabled or unavailable."
                )
            }
        )

        val permsOk = hasBluetoothConnectPermission() && hasBluetoothAdvertisePermission() && hasBluetoothScanPermission()
        steps.put(
            JSObject().apply {
                put("step", "2. Android Runtime Permissions")
                put("passed", permsOk)
                put(
                    "detail",
                    if (permsOk) "BLUETOOTH_CONNECT, BLUETOOTH_ADVERTISE & BLUETOOTH_SCAN granted."
                    else "Missing runtime Bluetooth permissions."
                )
            }
        )

        val proxyOk = hidDevice != null
        steps.put(
            JSObject().apply {
                put("step", "3. BluetoothHidDevice Service Proxy")
                put("passed", proxyOk)
                put(
                    "detail",
                    if (proxyOk) "BluetoothProfile.HID_DEVICE proxy active."
                    else "BluetoothProfile.HID_DEVICE proxy not connected. Tap 'Register Gamepad'."
                )
            }
        )

        steps.put(
            JSObject().apply {
                put("step", "4. HID Application & Descriptor Registration")
                put("passed", isHidRegistered)
                put(
                    "detail",
                    if (isHidRegistered) "Registered ($lastRegistrationCallbackMsg), Descriptor=${UNIVERSAL_GAMEPAD_HID_DESCRIPTOR.size}B"
                    else "HID application not registered ($lastRegistrationCallbackMsg)."
                )
            }
        )

        val host = connectedHost
        val hid = hidDevice
        val realOsConnected = if (hid != null && host != null && permsOk) {
            hid.getConnectionState(host) == BluetoothProfile.STATE_CONNECTED
        } else {
            false
        }
        steps.put(
            JSObject().apply {
                put("step", "5. Host L2CAP HID Connection")
                put("passed", realOsConnected)
                put(
                    "detail",
                    if (realOsConnected && host != null) {
                        "Connected to ${safeDeviceName(host)} [${host.address}] (BondState=${bondStateToString(host.bondState)})"
                    } else {
                        "No active Bluetooth HID host connection (Current state: $connectionStateStr)."
                    }
                )
            }
        )

        val testReportSent = if (realOsConnected) {
            sendZeroFailsafeReportInternal()
        } else {
            false
        }
        steps.put(
            JSObject().apply {
                put("step", "6. Live 9-Byte HID Report Transmission")
                put("passed", testReportSent)
                put(
                    "detail",
                    if (testReportSent) "Successfully transmitted 9-byte HID input report [00 00 08 00 00 00 00 00 00] to host."
                    else "Skipped/Failed: Host must be in CONNECTED state to transmit HID reports."
                )
            }
        )

        appendCallbackLog(
            "Diagnostic Self-Test executed: adapter=$adapterOk perms=$permsOk proxy=$proxyOk registered=$isHidRegistered connected=$realOsConnected reportSent=$testReportSent"
        )

        val ret = JSObject().apply {
            put("allPassed", adapterOk && permsOk && proxyOk && isHidRegistered && realOsConnected && testReportSent)
            put("readyForPairing", adapterOk && permsOk && proxyOk && isHidRegistered)
            put("steps", steps)
            put("status", buildFullStatusObject(null))
        }
        call.resolve(ret)
    }

    @SuppressLint("MissingPermission")
    private fun sendZeroFailsafeReportInternal(): Boolean {
        val hid = hidDevice ?: return false
        val host = connectedHost ?: return false
        val zeroReport = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)
        lastReportBytes = zeroReport
        return try {
            hid.sendReport(host, REPORT_ID, zeroReport)
        } catch (_: Exception) {
            false
        }
    }

    private fun formatHex(bytes: ByteArray): String {
        return bytes.joinToString(" ") { b -> "%02X".format(b) }
    }

    private fun bondStateToString(bondState: Int): String {
        return when (bondState) {
            BluetoothDevice.BOND_BONDED -> "BONDED"
            BluetoothDevice.BOND_BONDING -> "PAIRING"
            else -> "NONE"
        }
    }

    @SuppressLint("MissingPermission")
    private fun inspectDeviceCompatibility(device: BluetoothDevice): Triple<String, Boolean, String> {
        val nameUpper = (device.name ?: "").uppercase()
        val majorClass = device.bluetoothClass?.majorDeviceClass ?: BluetoothClass.Device.Major.MISC

        if (nameUpper.contains("PLAYSTATION") || nameUpper.contains("PS4") || nameUpper.contains("PS5")) {
            return Triple(
                "Console (Restricted)",
                false,
                "PS4/PS5 require Remote Play or a host adapter."
            )
        }
        if (nameUpper.contains("XBOX")) {
            return Triple(
                "Console (Restricted)",
                false,
                "Xbox consoles do not support generic Bluetooth HID gamepads directly."
            )
        }

        return when (majorClass) {
            BluetoothClass.Device.Major.COMPUTER -> Triple(
                "Windows 10/11 PC",
                true,
                "Supports standard Bluetooth HID Gamepad (DirectInput / Steam Input)."
            )
            BluetoothClass.Device.Major.AUDIO_VIDEO -> Triple(
                "Android TV / Google TV / Smart TV",
                true,
                "Compatible with Android TV, Google TV, and Smart TVs supporting Bluetooth HID gamepads."
            )
            BluetoothClass.Device.Major.PHONE -> Triple(
                "Mobile Host",
                true,
                "Supports standard Bluetooth HID Gamepad."
            )
            else -> Triple(
                "Bluetooth Host",
                true,
                "Standard Bluetooth HID host."
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun buildDeviceJSObject(device: BluetoothDevice): JSObject {
        val (deviceType, hidCompatible, compatibilityNote) = inspectDeviceCompatibility(device)
        val hid = hidDevice
        val osConnState = if (hid != null && hasBluetoothConnectPermission()) {
            try {
                hid.getConnectionState(device)
            } catch (_: Exception) {
                BluetoothProfile.STATE_DISCONNECTED
            }
        } else {
            BluetoothProfile.STATE_DISCONNECTED
        }
        val isActuallyConnected = (osConnState == BluetoothProfile.STATE_CONNECTED) ||
            (connectedHost?.address == device.address && connectionStateStr == "CONNECTED")

        return JSObject().apply {
            put("name", safeDeviceName(device))
            put("address", device.address)
            put("deviceType", deviceType)
            put("bondState", bondStateToString(device.bondState))
            put("isConnected", isActuallyConnected)
            put("hidCompatible", hidCompatible)
            put("compatibilityNote", compatibilityNote)
        }
    }

    @SuppressLint("MissingPermission")
    private fun buildFullStatusObject(errorMsg: String?): JSObject {
        if (errorMsg != null) {
            lastErrorMsg = errorMsg
        }
        val adapter = bluetoothAdapter
        val pairedArray = JSArray()
        if (adapter != null && hasBluetoothConnectPermission()) {
            adapter.bondedDevices?.forEach { dev ->
                pairedArray.put(buildDeviceJSObject(dev))
            }
        }

        val host = connectedHost
        val target = host ?: activeTargetDevice
        val connectedObj = if (host != null && hasBluetoothConnectPermission()) {
            buildDeviceJSObject(host)
        } else {
            null
        }

        val logsArray = JSArray()
        callbackHistory.forEach { entry ->
            logsArray.put(entry)
        }

        val effectivePairingStatus = when {
            host != null -> "BONDED"
            target != null && hasBluetoothConnectPermission() -> bondStateToString(target.bondState)
            else -> pairingStatusStr
        }

        val effectiveConnectionState = when {
            host != null && connectionStateStr == "CONNECTED" -> "CONNECTED"
            connectionStateStr == "CONNECTING" -> "CONNECTING"
            connectionStateStr == "PAIRING" -> "PAIRING"
            isDiscoverable && connectionStateStr == "DISCONNECTED" -> "DISCOVERABLE"
            effectivePairingStatus == "BONDED" && connectionStateStr == "BONDED" -> "BONDED"
            else -> connectionStateStr
        }

        return JSObject().apply {
            put("bluetoothEnabled", adapter?.isEnabled == true)
            put("hidProfileAvailable", isHidProfileAvailable || hidDevice != null)
            put("controllerBluetoothName", CONTROLLER_BLUETOOTH_NAME)
            put("hidRegistered", isHidRegistered)
            put("registrationCallbackMessage", lastRegistrationCallbackMsg)
            put("discoverable", isDiscoverable)
            put("pairingStatus", effectivePairingStatus)
            put("hostDeviceAddress", target?.address ?: lastConnectedHostAddress ?: "None")
            put("connectionState", effectiveConnectionState)
            put("connectedHost", connectedObj)
            put("pairedDevices", pairedArray)
            put("lastReportHex", formatHex(lastReportBytes))
            put("reportsSentCount", reportsSentCounter.get())
            put("error", errorMsg ?: lastErrorMsg)
            put("callbackLogs", logsArray)
        }
    }

    private fun emitStatusUpdate(errorMsg: String?) {
        notifyListeners("bluetoothHidStatusChanged", buildFullStatusObject(errorMsg))
    }
}
