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
 * NexoraBluetoothGamepadPlugin
 *
 * Production Native Android BluetoothHidDevice Capacitor Plugin for Game Volt Gamepad.
 * Registers the Android smartphone as a physical Bluetooth HID Game Controller ("Game Volt Gamepad")
 * using Android's BluetoothHidDevice system service (API 28+).
 */
@CapacitorPlugin(
    name = "NexoraBluetoothGamepad",
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
class NexoraBluetoothGamepadPlugin : Plugin() {

    companion object {
        const val CONTROLLER_BLUETOOTH_NAME = "Game Volt Gamepad"
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
     * - Byte 0: Buttons 1..8  (Bit 0=A, Bit 1=B, Bit 2=X, Bit 3=Y, Bit 4=LB, Bit 5=RB, Bit 6=LT, Bit 7=RT)
     * - Byte 1: Buttons 9..16 (Bit 0=View, Bit 1=Menu, Bit 2=L3, Bit 3=R3, Bit 4=Home, Bits 5..7=Padding)
     * - Byte 2: Low nibble = 8-way Hat Switch D-Pad (0=UP, 1=UP_RIGHT, 2=RIGHT, 3=DOWN_RIGHT, 4=DOWN, 5=DOWN_LEFT, 6=LEFT, 7=UP_LEFT, 8=CENTER)
     *           High nibble = 4-bit constant padding
     * - Byte 3: Left Stick X  (Usage 0x30 X, Logical -127..+127)
     * - Byte 4: Left Stick Y  (Usage 0x31 Y, Logical -127..+127)
     * - Byte 5: Right Stick X (Usage 0x32 Z, Logical -127..+127)
     * - Byte 6: Right Stick Y (Usage 0x35 Rz, Logical -127..+127)
     * - Byte 7: Left Trigger  (Usage Page 0x02 Simulation, Usage 0xC5 Brake, Logical 0..255)
     * - Byte 8: Right Trigger (Usage Page 0x02 Simulation, Usage 0xC4 Accelerator, Logical 0..255)
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
        0x75.toByte(), 0x01.toByte(),       //   Report Size (1 bit)
        0x95.toByte(), 0x10.toByte(),       //   Report Count (16 buttons)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        // 8-Way Hat Switch D-Pad (4 bits) + 4 bits Padding (1 Byte)
        0x05.toByte(), 0x01.toByte(),       //   Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x39.toByte(),       //   Usage (Hat switch)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x25.toByte(), 0x07.toByte(),       //   Logical Maximum (7)
        0x35.toByte(), 0x00.toByte(),       //   Physical Minimum (0 degrees)
        0x46.toByte(), 0x3B.toByte(), 0x01.toByte(), // Physical Maximum (315 degrees)
        0x65.toByte(), 0x14.toByte(),       //   Unit (Eng Rot:Angular Pos)
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4 bits)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x42.toByte(),       //   Input (Data,Var,Abs,Null)
        0x65.toByte(), 0x00.toByte(),       //   Unit (None)
        0x45.toByte(), 0x00.toByte(),       //   Physical Maximum (0)
        0x75.toByte(), 0x04.toByte(),       //   Report Size (4 bits padding)
        0x95.toByte(), 0x01.toByte(),       //   Report Count (1)
        0x81.toByte(), 0x01.toByte(),       //   Input (Const,Array,Abs)

        // 4 Analog Thumbstick Axes: Left X, Left Y, Right X, Right Y (-127..+127, 4 Bytes)
        0x05.toByte(), 0x01.toByte(),       //   Usage Page (Generic Desktop Ctrls)
        0x09.toByte(), 0x30.toByte(),       //   Usage (X - Left Stick Horizontal)
        0x09.toByte(), 0x31.toByte(),       //   Usage (Y - Left Stick Vertical)
        0x09.toByte(), 0x32.toByte(),       //   Usage (Z - Right Stick Horizontal)
        0x09.toByte(), 0x35.toByte(),       //   Usage (Rz - Right Stick Vertical)
        0x15.toByte(), 0x81.toByte(),       //   Logical Minimum (-127)
        0x25.toByte(), 0x7F.toByte(),       //   Logical Maximum (+127)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8 bits)
        0x95.toByte(), 0x04.toByte(),       //   Report Count (4 axes)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        // 2 Analog Triggers: LT (Brake) & RT (Accelerator) (0..255, 2 Bytes)
        0x05.toByte(), 0x02.toByte(),       //   Usage Page (Simulation Controls)
        0x09.toByte(), 0xC5.toByte(),       //   Usage (Brake - LT)
        0x09.toByte(), 0xC4.toByte(),       //   Usage (Accelerator - RT)
        0x15.toByte(), 0x00.toByte(),       //   Logical Minimum (0)
        0x26.toByte(), 0xFF.toByte(), 0x00.toByte(), // Logical Maximum (255)
        0x75.toByte(), 0x08.toByte(),       //   Report Size (8 bits)
        0x95.toByte(), 0x02.toByte(),       //   Report Count (2 triggers)
        0x81.toByte(), 0x02.toByte(),       //   Input (Data,Var,Abs)

        0xC0.toByte()                       // End Collection
    )

    override fun load() {
        super.load()
        bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        bluetoothAdapter = bluetoothManager?.adapter
    }

    override fun handleOnDestroy() {
        try {
            sendFailsafeZeroReportInternal()
            hidDevice?.unregisterApp()
            bluetoothAdapter?.closeProfileProxy(BluetoothProfile.HID_DEVICE, hidDevice)
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

    private fun formatHex(bytes: ByteArray): String {
        return bytes.joinToString(" ") { b -> String.format("%02X", b.toInt() and 0xFF) }
    }

    @PluginMethod
    fun checkCompatibility(call: PluginCall) {
        val sdkInt = Build.VERSION.SDK_INT
        val adapter = bluetoothAdapter
        val supportedApi = sdkInt >= Build.VERSION_CODES.P // Android 9.0 (API 28+) required for BluetoothHidDevice
        val hasBluetoothHardware = adapter != null
        val isEnabled = adapter?.isEnabled == true
        val permissionsGranted = hasBluetoothConnectPermission()

        val limitation: String? = when {
            !hasBluetoothHardware -> "This Android device does not have a Bluetooth hardware adapter."
            !supportedApi -> "Android 9.0 (API 28) or newer is required for BluetoothHidDevice. Detected API $sdkInt."
            !isEnabled -> "Bluetooth is currently turned off. Enable Bluetooth to register Game Volt Gamepad."
            !permissionsGranted -> "Bluetooth permissions are required to register Game Volt Gamepad."
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
                limitation ?: "Native Android BluetoothHidDevice is supported and ready on ${Build.MANUFACTURER} ${Build.MODEL}."
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
    fun registerHidDevice(call: PluginCall) {
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
            call.resolve(buildFullStatusObject("Bluetooth permission (BLUETOOTH_CONNECT) not granted."))
            return
        }

        try {
            adapter.name = CONTROLLER_BLUETOOTH_NAME
        } catch (_: Exception) {
        }

        // If already registered with an active proxy, return current status immediately
        if (hidDevice != null && isHidRegistered) {
            call.resolve(buildFullStatusObject(null))
            return
        }

        val serviceListener = object : BluetoothProfile.ServiceListener {
            override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                if (profile != BluetoothProfile.HID_DEVICE) return
                val hid = proxy as BluetoothHidDevice
                hidDevice = hid

                // Defensively unregister any stale session before registering
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
                        if (pluggedDevice != null && lastConnectedHostAddress == null) {
                            lastConnectedHostAddress = pluggedDevice.address
                        }
                        emitStatusUpdate(
                            if (registered) null else "Bluetooth HID profile unregistered by Android OS."
                        )
                    }

                    override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
                        when (state) {
                            BluetoothProfile.STATE_CONNECTED -> {
                                connectedHost = device
                                connectionStateStr = "CONNECTED"
                                lastConnectedHostAddress = device.address
                                // Send initial neutral report so host OS initializes all axes to center
                                sendFailsafeZeroReportInternal()
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
                        hidDevice?.replyReport(device, type, REPORT_ID.toByte(), lastReportBytes)
                    }

                    override fun onSetReport(
                        device: BluetoothDevice?,
                        type: Byte,
                        id: Byte,
                        data: ByteArray?
                    ) {
                        hidDevice?.reportError(device, BluetoothHidDevice.ERROR_RSP_SUCCESS)
                    }

                    override fun onSetProtocol(device: BluetoothDevice?, protocol: Byte) {
                        // Accept Report Protocol / Boot Protocol switch from host
                    }

                    override fun onVirtualCableUnplug(device: BluetoothDevice?) {
                        if (connectedHost?.address == device?.address) {
                            connectedHost = null
                            connectionStateStr = "DISCONNECTED"
                        }
                        emitStatusUpdate(null)
                    }
                }

                // Pass null for inQos (input-only peripheral) for maximum compatibility across Samsung, Pixel, Xiaomi
                val registeredOk = hid.registerApp(
                    sdpSettings,
                    null,
                    outQos,
                    hidExecutor,
                    callback
                )

                if (!registeredOk) {
                    call.resolve(
                        buildFullStatusObject(
                            "Android BluetoothHidDevice.registerApp() returned false. Ensure no other controller app is holding the Bluetooth HID profile."
                        )
                    )
                    return
                }

                isHidRegistered = true
                call.resolve(buildFullStatusObject(null))
            }

            override fun onServiceDisconnected(profile: Int) {
                if (profile == BluetoothProfile.HID_DEVICE) {
                    hidDevice = null
                    isHidRegistered = false
                    connectedHost = null
                    connectionStateStr = "DISCONNECTED"
                    emitStatusUpdate("Bluetooth HID system service disconnected.")
                }
            }
        }

        val proxyRequested = adapter.getProfileProxy(context, serviceListener, BluetoothProfile.HID_DEVICE)
        if (!proxyRequested) {
            call.resolve(
                buildFullStatusObject(
                    "This Android ROM rejected BluetoothProfile.HID_DEVICE access. Some custom OEM firmwares disable the Bluetooth HID peripheral profile."
                )
            )
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun unregisterHidDevice(call: PluginCall) {
        sendFailsafeZeroReportInternal()
        try {
            hidDevice?.unregisterApp()
        } catch (_: Exception) {
        }
        isHidRegistered = false
        connectedHost = null
        connectionStateStr = "DISCONNECTED"
        emitStatusUpdate(null)
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun startPairing(call: PluginCall) {
        val adapter = bluetoothAdapter
        if (adapter == null || !adapter.isEnabled) {
            call.resolve(buildFullStatusObject("Turn on Bluetooth before starting pairing."))
            return
        }
        try {
            adapter.name = CONTROLLER_BLUETOOTH_NAME
        } catch (_: Exception) {
        }

        val durationSeconds = call.getInt("durationSeconds", 300) ?: 300
        try {
            val discoverableIntent = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE).apply {
                putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, durationSeconds)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(discoverableIntent)
            isDiscoverable = true
            emitStatusUpdate(null)
            call.resolve(buildFullStatusObject(null))
        } catch (ex: Exception) {
            call.resolve(buildFullStatusObject("Could not launch Bluetooth discoverability dialog: ${ex.message}"))
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
        } catch (ex: Exception) {
            call.reject("Could not open Android Bluetooth Settings: ${ex.message}")
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun getPairedDevices(call: PluginCall) {
        if (!hasBluetoothConnectPermission()) {
            call.resolve(buildFullStatusObject("Grant Bluetooth permissions to list paired devices."))
            return
        }
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun connectHost(call: PluginCall) {
        val address = call.getString("address")
        if (address.isNullOrBlank()) {
            call.resolve(buildFullStatusObject("Host Bluetooth MAC address is required."))
            return
        }
        val hid = hidDevice
        val adapter = bluetoothAdapter
        if (hid == null || !isHidRegistered || adapter == null) {
            call.resolve(buildFullStatusObject("Register HID profile first before connecting to a host."))
            return
        }

        return try {
            val device = adapter.getRemoteDevice(address)
            connectionStateStr = "CONNECTING"
            val initiated = hid.connect(device)
            if (!initiated) {
                connectionStateStr = "DISCONNECTED"
                call.resolve(
                    buildFullStatusObject(
                        "Host ${device.name ?: address} rejected the HID connection request. Make sure Bluetooth is open on the host."
                    )
                )
            } else {
                lastConnectedHostAddress = address
                call.resolve(buildFullStatusObject(null))
            }
        } catch (ex: Exception) {
            connectionStateStr = "DISCONNECTED"
            call.resolve(buildFullStatusObject("Bluetooth connect error: ${ex.message}"))
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun reconnectLastHost(call: PluginCall) {
        val adapter = bluetoothAdapter
        val hid = hidDevice
        if (hid == null || !isHidRegistered || adapter == null) {
            call.resolve(buildFullStatusObject("Register HID profile first before reconnecting."))
            return
        }
        val targetAddress = lastConnectedHostAddress
            ?: adapter.bondedDevices?.firstOrNull()?.address
        if (targetAddress == null) {
            call.resolve(buildFullStatusObject("No paired Bluetooth host found. Pair your PC or TV first."))
            return
        }
        val device = adapter.getRemoteDevice(targetAddress)
        connectionStateStr = "CONNECTING"
        val ok = hid.connect(device)
        if (!ok) {
            connectionStateStr = "DISCONNECTED"
            call.resolve(buildFullStatusObject("Reconnection to ${device.name ?: targetAddress} failed."))
            return
        }
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun disconnectHost(call: PluginCall) {
        sendFailsafeZeroReportInternal()
        val host = connectedHost
        val hid = hidDevice
        if (host != null && hid != null) {
            hid.disconnect(host)
        }
        connectedHost = null
        connectionStateStr = "DISCONNECTED"
        emitStatusUpdate(null)
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun forgetDevice(call: PluginCall) {
        val address = call.getString("address")
        val adapter = bluetoothAdapter
        if (address.isNullOrBlank() || adapter == null) {
            call.resolve(buildFullStatusObject("Device address is required."))
            return
        }
        val device = adapter.getRemoteDevice(address)
        try {
            val method = device.javaClass.getMethod("removeBond")
            method.invoke(device)
        } catch (_: Exception) {
            val intent = Intent(Settings.ACTION_BLUETOOTH_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        if (connectedHost?.address == address) {
            connectedHost = null
            connectionStateStr = "DISCONNECTED"
        }
        emitStatusUpdate(null)
        call.resolve(buildFullStatusObject(null))
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun sendHidReport(call: PluginCall) {
        val buttonsMask = call.getInt("buttonsMask", 0) ?: 0
        val hat = call.getInt("hat", 8) ?: 8
        val lx = ((call.getDouble("leftX", 0.0) ?: 0.0) * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val ly = ((call.getDouble("leftY", 0.0) ?: 0.0) * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val rx = ((call.getDouble("rightX", 0.0) ?: 0.0) * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val ry = ((call.getDouble("rightY", 0.0) ?: 0.0) * 127.0).roundToInt().coerceIn(-127, 127).toByte()
        val lt = ((call.getDouble("lt", 0.0) ?: 0.0) * 255.0).roundToInt().coerceIn(0, 255).toByte()
        val rt = ((call.getDouble("rt", 0.0) ?: 0.0) * 255.0).roundToInt().coerceIn(0, 255).toByte()

        val report = byteArrayOf(
            (buttonsMask and 0xFF).toByte(),
            ((buttonsMask shr 8) and 0xFF).toByte(),
            (hat and 0x0F).toByte(),
            lx,
            ly,
            rx,
            ry,
            lt,
            rt
        )
        lastReportBytes = report

        val host = connectedHost
        val hid = hidDevice
        var sent = false
        if (host != null && hid != null && isHidRegistered) {
            sent = hid.sendReport(host, REPORT_ID, report)
            if (sent) {
                reportsSentCounter.incrementAndGet()
            }
        }

        val ret = JSObject().apply {
            put("sent", sent)
            put("reportHex", formatHex(report))
        }
        call.resolve(ret)
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    fun releaseAllInputs(call: PluginCall) {
        val sent = sendFailsafeZeroReportInternal()
        val ret = JSObject().apply {
            put("sent", sent)
        }
        call.resolve(ret)
    }

    @SuppressLint("MissingPermission")
    private fun sendFailsafeZeroReportInternal(): Boolean {
        return try {
            val neutralReport = byteArrayOf(0, 0, 8, 0, 0, 0, 0, 0, 0)
            lastReportBytes = neutralReport
            val host = connectedHost
            val hid = hidDevice
            if (host != null && hid != null && isHidRegistered) {
                hid.sendReport(host, REPORT_ID, neutralReport)
            } else {
                false
            }
        } catch (_: Exception) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    private fun inspectDeviceCompatibility(device: BluetoothDevice): Triple<String, Boolean, String> {
        val majorClass = device.bluetoothClass?.majorDeviceClass
        val devName = (device.name ?: "").lowercase()

        // Detect consoles or audio-only headsets that do not accept standard Bluetooth HID gamepads
        if (devName.contains("playstation") || devName.contains("ps4") || devName.contains("ps5")) {
            return Triple(
                "Console (Restricted)",
                false,
                "PS4/PS5 require proprietary hardware auth; use PS Remote Play on PC or Android TV."
            )
        }
        if (devName.contains("xbox")) {
            return Triple(
                "Console (Restricted)",
                false,
                "Xbox consoles do not support generic Bluetooth HID controllers directly."
            )
        }

        return when (majorClass) {
            BluetoothClass.Device.Major.COMPUTER -> Triple(
                "Windows / PC / Mac",
                true,
                "Supports standard Bluetooth HID Gamepad (DirectInput / Steam Input)."
            )
            BluetoothClass.Device.Major.AUDIO_VIDEO -> Triple(
                "Android TV / Smart TV",
                true,
                "Compatible if running Android TV, Google TV, webOS, or Tizen Gaming Hub."
            )
            BluetoothClass.Device.Major.PHONE -> Triple(
                "Android / Mobile Host",
                true,
                "Supports standard Bluetooth HID Gamepad."
            )
            else -> Triple(
                "Bluetooth Host",
                true,
                "Standard Bluetooth HID host compatibility."
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
