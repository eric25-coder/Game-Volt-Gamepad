# Erico Universal Gamepad Implementation Plan

This project will build a premium web-based smartphone game controller (React/Vite) that communicates via low-latency WebSockets to a C#/.NET Windows receiver application for virtual gamepad integration.

### User Review & Critical Decisions

- **Confirmed Priority**: Low-latency WebSocket communication.
- **Confirmed Receiver Tech**: C#/.NET (for Windows driver integration).
- **Core Strategy**: The web app serves as the controller UI; the Windows app acts as the WebSocket server and translates network inputs to a virtual HID/XInput controller.

### 1. Overview & Core Concept

- **What It Does**: Transforms a smartphone into a wireless gamepad using the browser.
- **Target Audience**: Gamers wanting to play PC games on their desktop while using their phone as a physical-feeling controller.
- **Key Value**: Low-latency remote controller functionality without dedicated hardware.

### 2. User Experience & Visual Design

- **Visual Identity**: Dark graphite background, metallic buttons, and customizable neon RGB lighting (pink/purple/blue).
- **Layout**: Landscape-first controller UI with responsive touch handlers for analog sticks and triggers.
- **Feedback**: Interactive button states (glow, scale, color changes) triggered by pointer events.

### 3. Key Product Decisions & Trade-Offs

- **WebSocket vs WebRTC**: Chosen WebSockets for simplicity in initial implementation while prioritizing low-latency frame timing (60Hz input polling).
- **C#/.NET Receiver**: Necessary to interface with virtual controller drivers (like ViGEmBus) which browsers cannot do directly.

### 4. Technical Architecture

```text
┌──────────────────┐       ┌────────────────────┐
│   Smartphone     │ ──WS─>│   Windows Receiver │
│ (React/PWA UI)   │       │ (C#/.NET WebSocket │
└──────────────────┘       │      Server)       │
                           └──────────┬─────────┘
                                      │
                           ┌──────────▼─────────┐
                           │ Virtual Gamepad    │
                           │   (Driver/XInput)  │
                           └────────────────────┘
```

- **Controller Input**: Multi-touch pointer events mapped to `axes` (joysticks) and `buttons` (A/B/X/Y/D-pad/Triggers).
- **WebSocket Protocol**: JSON packets for button states and axis values sent at a fixed polling interval (~16ms).
- **Windows Receiver**: C# application acting as the WebSocket server, mapping received JSON to virtual controller input commands.

### Execution Steps

1. **Phase 1**: Implement React controller UI with touch/pointer event handlers and basic WebSocket client.
2. **Phase 2**: Define the WebSocket JSON input protocol.
3. **Phase 3**: Develop the C# Windows Receiver application (requires user to compile/run this separately).
4. **Phase 4**: Add PWA support for installability.
5. **Phase 5**: Polish RGB animations and controller customization features.
