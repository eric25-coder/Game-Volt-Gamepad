package com.gamevolt.gamepad

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppQosSettings
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt

/**
 * GameVoltBluetoothGamepadPlugin
 *
 * Native Android BluetoothHidDevice Capacitor Plugin ("GameVoltBluetoothGamepad") for Game Volt gamepad.
 * Exposes core methods called by the TypeScript frontend:
 * - registerGamepad(call: PluginCall)
 * - sendHidReport(call: PluginCall)
 * - disconnect(call: PluginCall)
 * Along with pairing, host connection, and permission management.
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
        const val CONTROLLER_BLUETOOTH_NAME = "Game Volt gamepad"
        const val REPORT_ID: Int = 1
    }

    private var bluetoothManager: BluetoothManager? = null
    private var bluetoothAdapter: BluetoothAdapter? = null
    private var hidDevice: BluetoothHidDevice? = null
    @Volatile private var connectedHost: BluetoothDevice? = null
    @Volatile private var connectionStateStr: String = "DISCONNECTED"
    private var lastConnectedHostAddress: String? = null
    @Volatile private var isHidRegistered: Boolean = false
    @Volatile private var isDiscoverable: Boolean = false
    private val reportsSentCounter = AtomicLong(0)
    @Volatile private var lastReportBytes = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)
    private val hidExecutor = Executors.newSingleThreadExecutor()

    /**
     * Standards-Compliant Universal Gamepad HID Report Descriptor (Report ID 1, 9 Bytes):
     * - Byte 0: Buttons 1..8  (A, B, X, Y, LB, RB, LT, RT)
     * - Byte 1: Buttons 9..16 (View, Menu, L3, R3, Home + 3 bits padding)
     * - Byte 2: 8-way Hat Switch D-Pad (0=UP..7=UP_LEFT, 8=CENTER) + 4-bit padding
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

        // 16 Buttons (2 Bytes)
        0x05.toByte(), 0x09.toByte(),       //   Usage Page (Button)
        0x19.toByte(), 0x01.toByte(),       //   Usage Minimum (Button 1)
        0x29.toByte(), 0x10.toByte(),       //   Usage Maximum (Button 16)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x25.toByte(), 0x01.toByte(),       //   Logical Maximum (1)
        0x75.toByte(), 0x01.toByte(),       //   Report Size (1)
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
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x42.toByte(),       //   Input (Data,Var,Abs,Null)
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x01.toByte(),       //   Input (Const,Array,Abs)

        // 4 Analog Thumbstick Axes: X, Y, Z, Rz (4 Bytes, -127..+127)
        0x05.toByte(), 0x01.toByte(),       //   Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x30.toByte(),       //   Usage (X - Left Stick X)
        0x09.toByte(), 0x31.toByte(),       //   Usage (Y - Left Stick Y)
        0x09.toByte(), 0x32.toByte(),       //   Usage (Z - Right Stick X)
        0x09.toByte(), 0x35.toByte(),       //   Usage (Rz - Right Stick Y)
        0x15.toByte(), 0x81.toByte(),       //   Logical Minimum (-127)
        0x25.toByte(), 0x7F.toByte(),       //   Logical Maximum (127)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8)
        0x95.toByte(), 0x04.toByte(),       //   Report Count (4)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        // 2 Analog Triggers: Brake (LT) & Accelerator (RT) (2 Bytes, 0..255)
        0x05.toByte(), 0x02.toByte(),       //   Usage Page (Simulation Controls)
        0x09.toByte(), 0xC5.toByte(),       //   Usage (Brake - LT)
        0x09.toByte(), 0xC4.toByte(),       //   Usage (Accelerator - RT)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x26.toByte(), 0xFF.toByte(), 0x00.toByte(), // Logical Maximum (255)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8)
        0x95.toByte(), 0x02.toByte(),       //   Report Count (2)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        0xC0.toByte()                       // End Collection
    )

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                BluetoothAdapter.ACTION_SCAN_MODE_CHANGED -> {
                    val mode = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_SCAN_MODE,
                        BluetoothAdapter.SCAN_MODE_NONE
                    )
                    isDiscoverable = (mode == BluetoothAdapter.SCAN_MODE_CONNECTABLE_DISCOVERABLE)
                    emitStatusUpdate(null)
                }
                BluetoothAdapter.ACTION_STATE_CHANGED -> {
                    val state = intent.getIntExtra(
                        BluetoothAdapter.EXTRA_STATE,
                        BluetoothAdapter.ERROR
                    )
                    if (state == BluetoothAdapter.STATE_OFF || state == BluetoothAdapter.STATE_TURNING_OFF) {
                        connectedHost = null
                        connectionStateStr = "DISCONNECTED"
                        isHidRegistered = false
                        isDiscoverable = false
                    }
                    emitStatusUpdate(null)
                }
                BluetoothDevice.ACTION_BOND_STATE_CHANGED -> {
                    emitStatusUpdate(null)
                }
            }
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
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(bluetoothReceiver, filter)
        }
    }

    @SuppressLint("MissingPermission")
    override fun handleOnDestroy() {
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

    /**
     * 1. Core Interface Method: registerGamepad
     * Registers the Android device as a Bluetooth HID Gamepad ("Game Volt gamepad") via BluetoothHidDevice.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun registerGamepad(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            call.resolve(buildFullStatusObject("BluetoothHidDevice requires Android 9.0 (API 28) or higher."))
            return
        }
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            call.resolve(buildFullStatusObject("Bluetooth is disabled. Turn on Bluetooth in Android Settings."))
            return
        }
        if (!hasBluetoothConnectPermission()) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                requestPermissionForAlias("bluetooth12", call, "registerGamepadPermsCallback")
            } else {
                requestPermissionForAlias("bluetooth", call, "registerGamepadPermsCallback")
            }
            return
        }

        registerHidDeviceInternal(call)
    }

    @PermissionCallback
    private fun registerGamepadPermsCallback(call: PluginCall) {
        if (hasBluetoothConnectPermission()) {
            registerHidDeviceInternal(call)
        } else {
            call.resolve(buildFullStatusObject("Bluetooth runtime permissions were denied."))
        }
    }

    @SuppressLint("MissingPermission")
    private fun registerHidDeviceInternal(call: PluginCall) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            call.resolve(buildFullStatusObject("Bluetooth is disabled."))
            return
        }

        try {
            adapter.name = CONTROLLER_BLUETOOTH_NAME
        } catch (_: Exception) {
        }

        if (hidDevice != null && isHidRegistered) {
            call.resolve(buildFullStatusObject(null))
            return
        }

        val serviceListener = object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                if (profile != BluetoothProfile.HID_DEVICE) return
                val hid = proxy as BluetoothHidDevice
                hidDevice = hid

                try {
                    hid.unregisterApp()
                } catch (_: Exception) {
                }

                val sdpSettings = BluetoothHidDeviceAppSdpSettings(
                    CONTROLLER_BLUETOOTH_NAME,
                    "Game Volt Wireless Bluetooth HID Game Controller",
                    "Game Volt",
                    BluetoothHidDevice.SUBCLASS1_COMBO,
                    UNIVERSAL_GAMEPAD_HID_DESCRIPTOR
                )

                val outQos = BluetoothHidDeviceAppQosSettings(
                    BluetoothHidDeviceAppQosSettings.SERVICE_BEST_EFFORT,
                    800,
                    9,
                    0,
                    11250,
                    BluetoothHidDeviceAppQosSettings.MAX
                )

                val callback = object : BluetoothHidDevice.Callback() {
                    override fun onAppStatusChanged(
                        pluggedDevice: BluetoothDevice?,
                        registered: Boolean
                    ) {
                        isHidRegistered = registered
                        if (registered && pluggedDevice != null) {
                            lastConnectedHostAddress = pluggedDevice.address
                            if (hid.getConnectionState(pluggedDevice) == BluetoothProfile.STATE_CONNECTED) {
                                connectedHost = pluggedDevice
                                connectionStateStr = "CONNECTED"
                            }
                        } else if (!registered) {
                            connectedHost = null
                            connectionStateStr = "DISCONNECTED"
                        }
                        emitStatusUpdate(null)
                    }

                    override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
                        when (state) {
                            BluetoothProfile.STATE_CONNECTED -> {
                                connectedHost = device
                                lastConnectedHostAddress = device.address
                                connectionStateStr = "CONNECTED"
                                sendZeroFailsafeReportInternal()
                                emitStatusUpdate(null)
                            }
                            BluetoothProfile.STATE_CONNECTING -> {
                                connectionStateStr = "CONNECTING"
                                emitStatusUpdate(null)
                            }
                            BluetoothProfile.STATE_DISCONNECTING -> {
                                connectionStateStr = "DISCONNECTING"
                                emitStatusUpdate(null)
                            }
                            BluetoothProfile.STATE_DISCONNECTED -> {
                                if (connectedHost?.address == device.address) {
                                    connectedHost = null
                                }
                                connectionStateStr = "DISCONNECTED"
                                lastReportBytes = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)
                                emitStatusUpdate(null)
                            }
                        }
                    }

                    override fun onGetReport(
                        device: BluetoothDevice?,
                        type: Byte,
                        id: Byte,
                        bufferSize: Int
                    ) {
                        if (device == null) return
                        if (type == BluetoothHidDevice.REPORT_TYPE_INPUT) {
                            hidDevice?.replyReport(device, type, REPORT_ID.toByte(), lastReportBytes)
                        } else {
                            hidDevice?.replyReport(device, type, id, ByteArray(0))
                        }
                    }

                    override fun onSetReport(
                        device: BluetoothDevice?,
                        type: Byte,
                        id: Byte,
                        data: ByteArray?
                    ) {
                        if (device != null) {
                            hidDevice?.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS)
                        }
                    }

                    override fun onSetProtocol(device: BluetoothDevice?, protocol: Byte) {
                        // Accept Report Protocol and Boot Protocol requests
                    }

                    override fun onVirtualCableUnplug(device: BluetoothDevice?) {
                        if (connectedHost?.address == device?.address) {
                            connectedHost = null
                        }
                        connectionStateStr = "DISCONNECTED"
                        emitStatusUpdate(null)
                    }
                }

                val regSuccess = hid.registerApp(sdpSettings, null, outQos, hidExecutor, callback)
                if (!regSuccess) {
                    call.resolve(
                        buildFullStatusObject(
                            "Android BluetoothHidDevice.registerApp() returned false."
                        )
                    )
                } else {
                    isHidRegistered = true
                    call.resolve(buildFullStatusObject(null))
                }
            }

            override fun onServiceDisconnected(profile: Int) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    hidDevice = null
                    isHidRegistered = false
                    connectedHost = null
                    connectionStateStr = "DISCONNECTED"
                    emitStatusUpdate("Bluetooth HID service disconnected.")
                }
            }
        }

        val profileOpened = adapter.getProfileProxy(context, serviceListener, BluetoothProfile.HID_DEVICE)
        if (!profileOpened) {
            call.resolve(
                buildFullStatusObject(
                    "BluetoothProfile.HID_DEVICE is not available on this Android device."
                )
            )
        }
    }

    /**
     * 2. Core Interface Method: sendHidReport
     * Encodes and transmits the 9-byte Bluetooth HID Gamepad input report to the connected host.
     */
    @SuppressLint("MissingPermission")
    @PluginMethod
    fun sendHidReport(call: PluginCall) {
        val hid = hidDevice
        val host = connectedHost
        if (hid == null || host == null || !isHidRegistered) {
            val ret = JSObject().apply {
                put("sent", false)
                put("reportHex", formatHex(lastReportBytes))
            }
            call.resolve(ret)
            return
        }

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
        val sent = try {
            hid.sendReport(host, REPORT_ID, report)
        } catch (_: Exception) {
            false
        }
        if (sent) {
            reportsSentCounter.incrementAndGet()
        }

        val ret = JSObject().apply {
            put("sent", sent)
            put("reportHex", formatHex(report))
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
        val hid = hidDevice
        val host = connectedHost
        sendZeroFailsafeReportInternal()
        if (hid != null && host != null && hasBluetoothConnectPermission()) {
            try {
                hid.disconnect(host)
            } catch (_: Exception) {
            }
        }
        connectedHost = null
        connectionStateStr = "DISCONNECTED"
        call.resolve(buildFullStatusObject(null))
    }

    // Additional helper methods for compatibility, pairing, and host management
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
        val permissionsGranted = hasBluetoothConnectPermission()

        val limitation: String? = when {
            !hasBluetoothHardware -> "This Android device does not have a hardware Bluetooth adapter."
            !supportedApi -> "Android ${Build.VERSION.RELEASE} (API $sdkInt) detected. BluetoothHidDevice requires Android 9.0 (API 28) or higher."
            !isEnabled -> "Bluetooth is currently turned off. Enable Bluetooth to register the HID gamepad."
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
        val ret = JSObject().apply {
            put("granted", granted)
            put(
                "status",
                buildFullStatusObject(
                    if (granted) null else "Bluetooth runtime permissions were denied."
                )
            )
        }
        call.resolve(ret)
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun startPairing(call: PluginCall) {
        if (!hasBluetoothConnectPermission() || !hasBluetoothAdvertisePermission()) {
            call.resolve(buildFullStatusObject("Bluetooth Advertise/Connect permission not granted."))
            return
        }

        try {
            bluetoothAdapter?.name = CONTROLLER_BLUETOOTH_NAME
        } catch (_: Exception) {
        }

        val duration = call.getInt("durationSeconds", 300) ?: 300
        val discoverableIntent = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).apply {
            putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, duration)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(discoverableIntent)
        isDiscoverable = true
        call.resolve(buildFullStatusObject(null))
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
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connectHost(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.resolve(buildFullStatusObject("Missing target Bluetooth MAC address."))
            return
        }
        val hid = hidDevice
        if (hid == null || !isHidRegistered) {
            call.resolve(buildFullStatusObject("HID profile not registered yet. Tap Register HID first."))
            return
        }
        if (!hasBluetoothConnectPermission()) {
            call.resolve(buildFullStatusObject("Bluetooth Connect permission not granted."))
            return
        }

        val device = try {
            bluetoothAdapter?.getRemoteDevice(address)
        } catch (_: IllegalArgumentException) {
            null
        }
        if (device == null) {
            call.resolve(buildFullStatusObject("Invalid Bluetooth address: $address"))
            return
        }

        connectionStateStr = "CONNECTING"
        val initiated = hid.connect(device)
        lastConnectedHostAddress = address
        if (!initiated) {
            connectionStateStr = "DISCONNECTED"
        }
        call.resolve(
            buildFullStatusObject(
                if (initiated) null else "Could not initiate HID connection to ${device.name ?: address}."
            )
        )
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun reconnectLastHost(call: PluginCall) {
        val hid = hidDevice
        if (hid == null || !isHidRegistered) {
            call.resolve(buildFullStatusObject("HID profile not registered yet."))
            return
        }
        val targetAddr = lastConnectedHostAddress
            ?: bluetoothAdapter?.bondedDevices?.firstOrNull()?.address

        if (targetAddr == null) {
            call.resolve(buildFullStatusObject("No previously paired Bluetooth host found."))
            return
        }

        val device = bluetoothAdapter?.getRemoteDevice(targetAddr)
        if (device != null) {
            connectionStateStr = "CONNECTING"
            hid.connect(device)
            call.resolve(buildFullStatusObject(null))
        } else {
            call.resolve(buildFullStatusObject("Unable to locate Bluetooth host $targetAddr."))
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
                } catch (_: Exception) {
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
                "PC / Laptop",
                true,
                "Supports standard Bluetooth HID Gamepad."
            )
            BluetoothClass.Device.Major.AUDIO_VIDEO -> Triple(
                "Android TV / Smart TV",
                true,
                "Compatible with Android TV, Google TV, and Smart TVs."
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
        return JSObject().apply {
            put("name", device.name ?: device.address)
            put("address", device.address)
            put("deviceType", deviceType)
            put("isConnected", connectedHost?.address == device.address)
            put("hidCompatible", hidCompatible)
            put("compatibilityNote", compatibilityNote)
        }
    }

    @SuppressLint("MissingPermission")
    private fun buildFullStatusObject(errorMsg: String?): JSObject {
        val adapter = bluetoothAdapter
        val pairedArray = JSArray()
        if (adapter != null && hasBluetoothConnectPermission()) {
            adapter.bondedDevices?.forEach { dev ->
                pairedArray.put(buildDeviceJSObject(dev))
            }
        }

        val host = connectedHost
        val connectedObj = if (host != null && hasBluetoothConnectPermission()) {
            buildDeviceJSObject(host)
        } else {
            null
        }

        return JSObject().apply {
            put("bluetoothEnabled", adapter?.isEnabled == true)
            put("controllerBluetoothName", CONTROLLER_BLUETOOTH_NAME)
            put("hidRegistered", isHidRegistered)
            put("discoverable", isDiscoverable)
            put("connectionState", if (host != null) "CONNECTED" else connectionStateStr)
            put("connectedHost", connectedObj)
            put("pairedDevices", pairedArray)
            put("lastReportHex", formatHex(lastReportBytes))
            put("reportsSentCount", reportsSentCounter.get())
            put("error", errorMsg)
        }
    }

    private fun emitStatusUpdate(errorMsg: String?) {
        notifyListeners("bluetoothHidStatusChanged", buildFullStatusObject(errorMsg))
    }
}
