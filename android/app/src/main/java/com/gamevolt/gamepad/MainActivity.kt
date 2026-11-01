package com.gamevolt.gamepad

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        // Register native GameVoltBluetoothGamepad plugin before super.onCreate
        registerPlugin(GameVoltBluetoothGamepadPlugin::class.java)
        registerPlugin(NexoraBluetoothGamepadPlugin::class.java)
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
