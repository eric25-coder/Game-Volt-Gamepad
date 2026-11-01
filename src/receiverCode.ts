export const CSHARP_WINDOWS_RECEIVER_CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net8.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <AssemblyName>GamevoltWindowsReceiver</AssemblyName>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Fleck" Version="1.2.0" />
    <PackageReference Include="Nefarius.ViGEm.Client" Version="1.21.256" />
  </ItemGroup>
</Project>
`;

export const CSHARP_WINDOWS_RECEIVER_CODE = `// ============================================================================
// GAMEVOLT GAMEPAD - WINDOWS PC RECEIVER (.NET 8 / C# + ViGEmBus XInput SDK)
// ============================================================================
// Architecture:
// Android Phone (Gamevolt GAMEPAD) -> Wi-Fi/Hotspot -> WebSocket (Port 8765)
// -> C#/.NET Receiver -> Nefarius ViGEmBus Kernel Driver -> Windows XInput Games
//
// Setup & Run Instructions:
// 1. Install the official Nefarius ViGEmBus Driver on Windows 10/11:
//    https://github.com/nefarius/ViGEmBus/releases/latest
// 2. Save GamevoltWindowsReceiver.csproj and Program.cs in a folder and run:
//    dotnet run
// 3. Open Windows "Set up USB game controllers" (joy.cpl) to see the live
//    "Controller (Xbox 360 For Windows)" hardware device respond in real time!
// ============================================================================

using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using Fleck;
using Nefarius.ViGEm.Client;
using Nefarius.ViGEm.Client.Targets;
using Nefarius.ViGEm.Client.Targets.Xbox360;

namespace GamevoltWindowsReceiver
{
    public class ControllerPacket
    {
        public string? type { get; set; }
        public int seq { get; set; }
        public double timestamp { get; set; }
        public ButtonsState? buttons { get; set; }
        public AxesState? axes { get; set; }
        public string? dpad { get; set; }
    }

    public class ButtonsState
    {
        public bool A { get; set; }
        public bool B { get; set; }
        public bool X { get; set; }
        public bool Y { get; set; }
        public bool LB { get; set; }
        public bool RB { get; set; }
        public bool LT { get; set; }
        public bool RT { get; set; }
        public bool View { get; set; }
        public bool Menu { get; set; }
        public bool Home { get; set; }
        public bool L3 { get; set; }
        public bool R3 { get; set; }
    }

    public class AxesState
    {
        public double leftX { get; set; }
        public double leftY { get; set; }
        public double rightX { get; set; }
        public double rightY { get; set; }
        public double LT { get; set; }
        public double RT { get; set; }
    }

    class Program
    {
        private static ViGEmClient? _vigemClient;
        private static IXbox360Controller? _xboxController;
        private static bool _vigemConfirmed = false;
        private static string _vigemStatusText = "DRIVER_NOT_INITIALIZED";
        private static long _lastInputTick = 0;
        private static long _totalPacketsReceived = 0;
        private static readonly ConcurrentDictionary<Guid, IWebSocketConnection> _clients = new();

        static void Main(string[] args)
        {
            Console.Title = "Gamevolt Universal Gamepad - Windows XInput Receiver";
            Console.WriteLine("================================================================");
            Console.WriteLine("  GAMEVOLT UNIVERSAL GAMEPAD - WINDOWS XINPUT VIRTUAL RECEIVER  ");
            Console.WriteLine("================================================================");

            // 1. Initialize & Verify Real Windows ViGEmBus Virtual Xbox 360 Controller
            InitializeVirtualController();

            // 2. Register clean shutdown hooks so virtual controller is always released & destroyed safely
            Console.CancelKeyPress += (s, e) =>
            {
                e.Cancel = true;
                SafeShutdown();
                Environment.Exit(0);
            };
            AppDomain.CurrentDomain.ProcessExit += (s, e) => SafeShutdown();

            // 3. Start Watchdog Timer (Failsafe: releases all held buttons if connection stalls > 600ms)
            using var watchdog = new Timer(_ =>
            {
                long last = Interlocked.Read(ref _lastInputTick);
                if (last > 0 && (Environment.TickCount64 - last) > 600)
                {
                    Interlocked.Exchange(ref _lastInputTick, 0);
                    ResetControllerSafe();
                }
            }, null, 200, 200);

            string localIp = GetLocalIPAddress();
            int port = 8765;
            string pairingPin = "GV" + new Random().Next(1000, 9999);

            var server = new WebSocketServer($"ws://0.0.0.0:{port}");
            server.RestartAfterListenError = true;

            server.Start(socket =>
            {
                socket.OnOpen = () =>
                {
                    _clients[socket.ConnectionInfo.Id] = socket;
                    Console.WriteLine($"[CONNECTED] Phone paired from {socket.ConnectionInfo.ClientIpAddress}");

                    // Send real hardware confirmation telemetry to the phone
                    SendReceiverTelemetry(socket, pairingPin);
                };

                socket.OnClose = () =>
                {
                    _clients.TryRemove(socket.ConnectionInfo.Id, out _);
                    Console.WriteLine($"[DISCONNECTED] Phone {socket.ConnectionInfo.ClientIpAddress} disconnected. Releasing all buttons.");
                    ResetControllerSafe();
                };

                socket.OnError = ex =>
                {
                    Console.WriteLine($"[SOCKET ERROR] {ex.Message} -> Releasing all buttons.");
                    ResetControllerSafe();
                };

                socket.OnBinary = bytes =>
                {
                    if (bytes != null && bytes.Length >= 9)
                    {
                        Interlocked.Exchange(ref _lastInputTick, Environment.TickCount64);
                        Interlocked.Increment(ref _totalPacketsReceived);
                        ApplyBinaryHidReport(bytes);
                    }
                };

                socket.OnMessage = message =>
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(message);
                        var root = doc.RootElement;
                        if (!root.TryGetProperty("type", out var typeProp)) return;

                        string msgType = typeProp.GetString() ?? "";

                        if (msgType == "ping")
                        {
                            double clientTs = root.TryGetProperty("timestamp", out var t) ? t.GetDouble() : 0;
                            socket.Send(JsonSerializer.Serialize(new
                            {
                                type = "pong",
                                clientTimestamp = clientTs,
                                serverTimestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                                vigemStatus = _vigemConfirmed ? "CONNECTED" : _vigemStatusText,
                                hostName = Environment.MachineName,
                                packetsProcessed = Interlocked.Read(ref _totalPacketsReceived)
                            }));
                            return;
                        }

                        if (msgType == "controller_input")
                        {
                            var packet = JsonSerializer.Deserialize<ControllerPacket>(message);
                            if (packet != null)
                            {
                                Interlocked.Exchange(ref _lastInputTick, Environment.TickCount64);
                                Interlocked.Increment(ref _totalPacketsReceived);
                                ApplyToVirtualXbox(packet);
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"[PACKET ERROR] Malformed input frame ignored: {ex.Message}");
                    }
                };
            });

            Console.WriteLine($"\\n[NETWORK READY] Local Wi-Fi WebSocket Endpoint:");
            Console.WriteLine($"  -> URL:         ws://{localIp}:{port}");
            Console.WriteLine($"  -> Pairing PIN: {pairingPin}");
            Console.WriteLine($"  -> Host Name:   {Environment.MachineName}");
            Console.WriteLine($"  -> ViGEm State: {(_vigemConfirmed ? "XBOX 360 VIRTUAL CONTROLLER ACTIVE" : _vigemStatusText)}");
            Console.WriteLine("\\nOpen 'Set up USB game controllers' (joy.cpl) in Windows to verify inputs.");
            Console.WriteLine("Press ENTER or Ctrl+C to safely destroy virtual controller and exit...");
            Console.ReadLine();
            SafeShutdown();
        }

        static void InitializeVirtualController()
        {
            try
            {
                _vigemClient = new ViGEmClient();
                _xboxController = _vigemClient.CreateXbox360Controller();
                _xboxController.AutoSubmitReport = false;

                // Forward Windows game force-feedback rumble motors back to the Android phone
                _xboxController.FeedbackReceived += (sender, args) =>
                {
                    if (args.LargeMotor > 10 || args.SmallMotor > 10)
                    {
                        string rumbleJson = JsonSerializer.Serialize(new
                        {
                            type = "rumble",
                            largeMotor = args.LargeMotor,
                            smallMotor = args.SmallMotor,
                            durationMs = 90
                        });
                        foreach (var client in _clients.Values)
                        {
                            if (client.IsAvailable) client.Send(rumbleJson);
                        }
                    }
                };

                _xboxController.Connect();
                ResetControllerSafe();
                _vigemConfirmed = true;
                _vigemStatusText = "CONNECTED";
                Console.WriteLine("[OK] Windows confirmed Virtual Xbox 360 Controller creation via ViGEmBus.");
            }
            catch (Exception ex)
            {
                _vigemConfirmed = false;
                _vigemStatusText = "DRIVER_MISSING";
                Console.WriteLine("[ERROR] Windows ViGEmBus driver failed to initialize: " + ex.Message);
                Console.WriteLine("        Install ViGEmBus_Setup_x64.exe from https://github.com/nefarius/ViGEmBus/releases");
            }
        }

        static void SendReceiverTelemetry(IWebSocketConnection socket, string pin)
        {
            if (!socket.IsAvailable) return;
            socket.Send(JsonSerializer.Serialize(new
            {
                type = "receiver_status",
                receiverConnected = true,
                vigemStatus = _vigemConfirmed ? "CONNECTED" : _vigemStatusText,
                hostName = Environment.MachineName,
                pairingPin = pin,
                controllerType = "Xbox 360 XInput (ViGEmBus)",
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            }));
        }

        static double SanitizeAxis(double val, double min, double max)
        {
            if (double.IsNaN(val) || double.IsInfinity(val)) return 0.0;
            return Math.Clamp(val, min, max);
        }

        static void ApplyToVirtualXbox(ControllerPacket p)
        {
            if (_xboxController == null || !_vigemConfirmed) return;

            if (p.buttons != null)
            {
                _xboxController.SetButtonState(Xbox360Button.A, p.buttons.A);
                _xboxController.SetButtonState(Xbox360Button.B, p.buttons.B);
                _xboxController.SetButtonState(Xbox360Button.X, p.buttons.X);
                _xboxController.SetButtonState(Xbox360Button.Y, p.buttons.Y);
                _xboxController.SetButtonState(Xbox360Button.LeftShoulder, p.buttons.LB);
                _xboxController.SetButtonState(Xbox360Button.RightShoulder, p.buttons.RB);
                _xboxController.SetButtonState(Xbox360Button.Back, p.buttons.View);
                _xboxController.SetButtonState(Xbox360Button.Start, p.buttons.Menu);
                _xboxController.SetButtonState(Xbox360Button.Guide, p.buttons.Home);
                _xboxController.SetButtonState(Xbox360Button.LeftThumb, p.buttons.L3);
                _xboxController.SetButtonState(Xbox360Button.RightThumb, p.buttons.R3);
            }

            string dpad = p.dpad ?? "CENTER";
            _xboxController.SetButtonState(Xbox360Button.Up, dpad.Contains("UP"));
            _xboxController.SetButtonState(Xbox360Button.Down, dpad.Contains("DOWN"));
            _xboxController.SetButtonState(Xbox360Button.Left, dpad.Contains("LEFT"));
            _xboxController.SetButtonState(Xbox360Button.Right, dpad.Contains("RIGHT"));

            if (p.axes != null)
            {
                double lxNorm = SanitizeAxis(p.axes.leftX, -1.0, 1.0);
                double lyNorm = SanitizeAxis(p.axes.leftY, -1.0, 1.0);
                double rxNorm = SanitizeAxis(p.axes.rightX, -1.0, 1.0);
                double ryNorm = SanitizeAxis(p.axes.rightY, -1.0, 1.0);

                short lx = (short)Math.Clamp(lxNorm * 32767.0, -32768.0, 32767.0);
                short ly = (short)Math.Clamp(-lyNorm * 32767.0, -32768.0, 32767.0);
                short rx = (short)Math.Clamp(rxNorm * 32767.0, -32768.0, 32767.0);
                short ry = (short)Math.Clamp(-ryNorm * 32767.0, -32768.0, 32767.0);

                _xboxController.SetAxisValue(Xbox360Axis.LeftThumbX, lx);
                _xboxController.SetAxisValue(Xbox360Axis.LeftThumbY, ly);
                _xboxController.SetAxisValue(Xbox360Axis.RightThumbX, rx);
                _xboxController.SetAxisValue(Xbox360Axis.RightThumbY, ry);

                double ltRaw = p.buttons?.LT == true ? Math.Max(p.axes.LT, 1.0) : p.axes.LT;
                double rtRaw = p.buttons?.RT == true ? Math.Max(p.axes.RT, 1.0) : p.axes.RT;

                byte ltByte = (byte)Math.Clamp(SanitizeAxis(ltRaw, 0.0, 1.0) * 255.0, 0.0, 255.0);
                byte rtByte = (byte)Math.Clamp(SanitizeAxis(rtRaw, 0.0, 1.0) * 255.0, 0.0, 255.0);

                _xboxController.SetSliderValue(Xbox360Slider.LeftTrigger, ltByte);
                _xboxController.SetSliderValue(Xbox360Slider.RightTrigger, rtByte);
            }

            _xboxController.SubmitReport();
        }

        // Decodes 9-byte Bluetooth/USB HID Gamepad Report [BtnLo, BtnHi, Hat, LX, LY, RX, RY, LT, RT]
        static void ApplyBinaryHidReport(byte[] r)
        {
            if (_xboxController == null || !_vigemConfirmed || r.Length < 9) return;

            int mask = r[0] | (r[1] << 8);
            _xboxController.SetButtonState(Xbox360Button.A, (mask & (1 << 0)) != 0);
            _xboxController.SetButtonState(Xbox360Button.B, (mask & (1 << 1)) != 0);
            _xboxController.SetButtonState(Xbox360Button.X, (mask & (1 << 2)) != 0);
            _xboxController.SetButtonState(Xbox360Button.Y, (mask & (1 << 3)) != 0);
            _xboxController.SetButtonState(Xbox360Button.LeftShoulder, (mask & (1 << 4)) != 0);
            _xboxController.SetButtonState(Xbox360Button.RightShoulder, (mask & (1 << 5)) != 0);
            _xboxController.SetButtonState(Xbox360Button.Back, (mask & (1 << 8)) != 0);
            _xboxController.SetButtonState(Xbox360Button.Start, (mask & (1 << 9)) != 0);
            _xboxController.SetButtonState(Xbox360Button.LeftThumb, (mask & (1 << 10)) != 0);
            _xboxController.SetButtonState(Xbox360Button.RightThumb, (mask & (1 << 11)) != 0);
            _xboxController.SetButtonState(Xbox360Button.Guide, (mask & (1 << 12)) != 0);

            int hat = r[2] & 0x0F;
            _xboxController.SetButtonState(Xbox360Button.Up, hat == 0 || hat == 1 || hat == 7);
            _xboxController.SetButtonState(Xbox360Button.Right, hat == 1 || hat == 2 || hat == 3);
            _xboxController.SetButtonState(Xbox360Button.Down, hat == 3 || hat == 4 || hat == 5);
            _xboxController.SetButtonState(Xbox360Button.Left, hat == 5 || hat == 6 || hat == 7);

            sbyte lx = (sbyte)r[3];
            sbyte ly = (sbyte)r[4];
            sbyte rx = (sbyte)r[5];
            sbyte ry = (sbyte)r[6];

            _xboxController.SetAxisValue(Xbox360Axis.LeftThumbX, (short)Math.Clamp(lx * 258, -32768, 32767));
            _xboxController.SetAxisValue(Xbox360Axis.LeftThumbY, (short)Math.Clamp(-ly * 258, -32768, 32767));
            _xboxController.SetAxisValue(Xbox360Axis.RightThumbX, (short)Math.Clamp(rx * 258, -32768, 32767));
            _xboxController.SetAxisValue(Xbox360Button.RightThumb != null ? Xbox360Axis.RightThumbY : Xbox360Axis.RightThumbY, (short)Math.Clamp(-ry * 258, -32768, 32767));

            _xboxController.SetSliderValue(Xbox360Slider.LeftTrigger, r[7]);
            _xboxController.SetSliderValue(Xbox360Slider.RightTrigger, r[8]);
            _xboxController.SubmitReport();
        }

        static void ResetControllerSafe()
        {
            try
            {
                if (_xboxController != null && _vigemConfirmed)
                {
                    _xboxController.ResetReport();
                    _xboxController.SubmitReport();
                }
            }
            catch { }
        }

        static void SafeShutdown()
        {
            try
            {
                ResetControllerSafe();
                if (_xboxController != null && _vigemConfirmed)
                {
                    _xboxController.Disconnect();
                    _vigemConfirmed = false;
                }
                _vigemClient?.Dispose();
                Console.WriteLine("[SHUTDOWN] Virtual Xbox 360 Controller safely released and destroyed.");
            }
            catch { }
        }

        static string GetLocalIPAddress()
        {
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0);
                socket.Connect("8.8.8.8", 65530);
                if (socket.LocalEndPoint is IPEndPoint endPoint)
                {
                    return endPoint.Address.ToString();
                }
            }
            catch { }

            var host = Dns.GetHostEntry(Dns.GetHostName());
            foreach (var ip in host.AddressList)
            {
                if (ip.AddressFamily == AddressFamily.InterNetwork) return ip.ToString();
            }
            return "127.0.0.1";
        }
    }
}
`;
