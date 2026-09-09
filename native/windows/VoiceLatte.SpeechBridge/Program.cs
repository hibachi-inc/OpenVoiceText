using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Globalization;
using System.Speech.Recognition;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Speech;
using Microsoft.Windows.AI.Text;
using NAudio.Wave;
using Windows.Media.Devices;

record BridgeRequest(
    int Id,
    string Command,
    string? Locale,
    string[]? Vocabulary,
    string? Text,
    string? Category,
    string? Prompt,
    string? Shortcut,
    string[]? Shortcuts,
    string? DeviceUID,
    bool? MuteOtherAudio,
    string? Permission,
    bool? AutoPaste,
    string? AudioPath,
    string? CloudProvider,
    string? ScreenContext
);

record AudioDeviceResponse(string Uid, string Name);

record BridgeResponse(
    int Id,
    string Type,
    string Platform = "windows",
    string? Backend = null,
    string? ModelState = null,
    bool? SupportsStreaming = null,
    string? Message = null,
    string? Text = null,
    float? Level = null,
    string? AppName = null,
    string? BundleID = null,
    string? Category = null,
    string? PromptKey = null,
    string? ScreenContext = null,
    double? DisplayX = null,
    double? DisplayY = null,
    string? Shortcut = null,
    AudioDeviceResponse[]? Devices = null,
    string? MicrophonePermission = null,
    string? SpeechPermission = null,
    string? AccessibilityPermission = null
);

static class Program
{
    [STAThread]
    static async Task Main()
    {
        var bridge = new Bridge();
        while (Console.ReadLine() is { } line)
        {
            try
            {
                var request = JsonSerializer.Deserialize<BridgeRequest>(line, JsonOptions.Read)
                    ?? throw new InvalidDataException("Invalid bridge request");
                await bridge.Handle(request);
            }
            catch (Exception error)
            {
                Bridge.Emit(new(0, "error", Message: error.Message));
            }
        }
    }
}

sealed class Bridge
{
    StreamingRecognition? recognition;
    SpeechRecognitionEngine? classicRecognition;
    SpeechRecognitionModel? model;
    ModifierKeyboardHook? hotkey;
    WaveInEvent? cloudCapture;
    WaveFileWriter? cloudWriter;
    readonly object gate = new();
    int recordingId;
    string confirmed = "";
    string provisional = "";
    IntPtr pasteTargetWindow;

    public async Task Handle(BridgeRequest request)
    {
        switch (request.Command)
        {
            case "status": EmitStatus(request.Id); break;
            case "warm_up": await EnsureModel(request.Id, emitReady: true); break;
            case "install_model": await EnsureModel(request.Id, emitInstalled: true); break;
            case "context": EmitContext(request.Id); break;
            case "settings_status": Emit(new(request.Id, "settings", Devices: [], MicrophonePermission: "system-managed", SpeechPermission: "system-managed", AccessibilityPermission: "not-required")); break;
            case "request_permission": Emit(new(request.Id, "ready")); break;
            case "start": await Start(request); break;
            case "stop": Stop(request.Id); break;
            case "cancel": Stop(request.Id); break;
            case "refine": Emit(new(request.Id, "refined", Text: await Refine(request))); break;
            case "insert": Insert(request.Text ?? "", request.AutoPaste != false); Emit(new(request.Id, "inserted", Text: request.Text ?? "")); break;
            case "configure_shortcut": ConfigureShortcuts(request.Shortcuts ?? (string.IsNullOrEmpty(request.Shortcut) ? [] : [request.Shortcut])); Emit(new(request.Id, "ready")); break;
            default: Emit(new(request.Id, "error", Message: $"Unsupported command: {request.Command}")); break;
        }
    }

    void EmitStatus(int id)
    {
        var state = SpeechRecognitionModel.GetReadyState();
        Emit(new(
            id,
            "status",
            Backend: "microsoft-windows-ai-speech",
            ModelState: state switch
            {
                AIFeatureReadyState.Ready => "ready",
                AIFeatureReadyState.NotSupportedOnCurrentSystem => "unsupported",
                _ => "download-required",
            },
            SupportsStreaming: state != AIFeatureReadyState.NotSupportedOnCurrentSystem,
            Message: state switch
            {
                AIFeatureReadyState.Ready => "Windows高精度音声認識を利用できます",
                AIFeatureReadyState.NotSupportedOnCurrentSystem => "このPCではWindows AI Speechを利用できません",
                _ => "Windows音声認識モデルの追加が必要です",
            }
        ));
    }

    void EmitContext(int id)
    {
        var window = GetForegroundWindow();
        double? displayX = null;
        double? displayY = null;
        if (GetWindowRect(window, out var rect))
        {
            displayX = rect.Left + (rect.Right - rect.Left) / 2.0;
            displayY = rect.Top + (rect.Bottom - rect.Top) / 2.0;
        }
        GetWindowThreadProcessId(window, out var processId);
        var name = processId == 0 ? "Unknown" : Process.GetProcessById((int)processId).ProcessName;
        var lower = name.ToLowerInvariant();
        var category = lower.Contains("code") || lower.Contains("studio") || lower.Contains("jetbrains") ? "code"
            : lower.Contains("terminal") || lower.Contains("powershell") || lower.Contains("cmd") ? "terminal"
            : lower.Contains("slack") || lower.Contains("discord") || lower.Contains("teams") ? "chat"
            : lower.Contains("mail") || lower.Contains("outlook") ? "email"
            : lower.Contains("note") || lower.Contains("obsidian") ? "notes"
            : lower.Contains("chrome") || lower.Contains("edge") || lower.Contains("firefox") ? "browser"
            : "generic";
        Emit(new(id, "context", AppName: name, Category: category, PromptKey: name, DisplayX: displayX, DisplayY: displayY));
    }

    async Task<bool> EnsureModel(int id, bool emitReady = false, bool emitInstalled = false, bool emitErrors = true)
    {
        var state = SpeechRecognitionModel.GetReadyState();
        if (state != AIFeatureReadyState.Ready)
        {
            var ready = await SpeechRecognitionModel.EnsureReadyAsync();
            if (ready.Status != AIFeatureReadyResultState.Success)
            {
                if (emitErrors) Emit(new(id, "error", Message: "Windows音声認識モデルを準備できませんでした"));
                return false;
            }
        }
        var result = await SpeechRecognitionModel.TryCreateAsync();
        model = result.SpeechModel;
        if (model is null)
        {
            if (emitErrors) Emit(new(id, "error", Message: result.ExtendedError?.Message ?? "Windows音声認識モデルを読み込めませんでした"));
            return false;
        }
        if (emitReady) Emit(new(id, "ready", Message: "音声認識を準備しました"));
        if (emitInstalled) Emit(new(id, "installed", Message: "Windows音声認識モデルを追加しました"));
        return true;
    }

    async Task Start(BridgeRequest request)
    {
        pasteTargetWindow = GetForegroundWindow();
        if (!string.IsNullOrWhiteSpace(request.AudioPath))
        {
            StartCloud(request);
            return;
        }
        if (SpeechRecognitionModel.GetReadyState() != AIFeatureReadyState.Ready
            || !await EnsureModel(request.Id, emitErrors: false))
        {
            StartClassic(request);
            return;
        }
        recordingId = request.Id;
        confirmed = "";
        provisional = "";
        try
        {
            var deviceId = MediaDevice.GetDefaultAudioCaptureId(AudioDeviceRole.Default);
            var audio = AudioConfiguration.FromAudioDevice(deviceId);
            recognition = new StreamingRecognition(audio, model!);
            recognition.Recognizing += (_, args) =>
            {
                lock (gate) provisional = args.Text;
                Emit(new(recordingId, "transcript", Text: FullTranscript()));
            };
            recognition.Recognized += (_, args) =>
            {
                lock (gate)
                {
                    if (args.IsFinal && !string.IsNullOrWhiteSpace(args.Text)) confirmed = Join(confirmed, args.Text);
                    provisional = args.IsFinal ? "" : args.Text;
                }
                Emit(new(recordingId, "transcript", Text: FullTranscript()));
            };
            Emit(new(request.Id, "engine", Backend: "microsoft-windows-ai-speech"));
            await recognition.StartContinuousRecognitionAsync();
            Emit(new(request.Id, "started", Message: "聞き取り中"));
        }
        catch (Exception error)
        {
            recognition?.Dispose();
            recognition = null;
            Emit(new(request.Id, "engine", Backend: "windows-speech-classic", Message: $"高精度モデルから標準認識へ切り替えました: {error.Message}"));
            StartClassic(request);
        }
    }

    void StartCloud(BridgeRequest request)
    {
        try
        {
            recordingId = request.Id;
            confirmed = "";
            provisional = "";
            cloudCapture = new WaveInEvent { WaveFormat = new WaveFormat(16000, 16, 1), BufferMilliseconds = 50 };
            cloudWriter = new WaveFileWriter(request.AudioPath!, cloudCapture.WaveFormat);
            cloudCapture.DataAvailable += (_, args) =>
            {
                lock (gate)
                {
                    cloudWriter?.Write(args.Buffer, 0, args.BytesRecorded);
                    cloudWriter?.Flush();
                }
                double sum = 0;
                for (var index = 0; index + 1 < args.BytesRecorded; index += 2)
                {
                    var sample = BitConverter.ToInt16(args.Buffer, index) / 32768d;
                    sum += sample * sample;
                }
                var samples = Math.Max(args.BytesRecorded / 2, 1);
                Emit(new(recordingId, "audio_level", Level: (float)Math.Clamp(Math.Sqrt(sum / samples) * 10, 0, 1)));
            };
            cloudCapture.StartRecording();
            Emit(new(request.Id, "engine", Backend: request.CloudProvider ?? "cloud"));
            Emit(new(request.Id, "started", Message: "聞き取り中"));
        }
        catch (Exception error)
        {
            StopCloudCapture();
            Emit(new(request.Id, "error", Message: $"録音を開始できません: {error.Message}"));
        }
    }

    void StartClassic(BridgeRequest request)
    {
        try
        {
            recordingId = request.Id;
            confirmed = "";
            provisional = "";
            classicRecognition = new SpeechRecognitionEngine(new CultureInfo(request.Locale ?? "ja-JP"));
            classicRecognition.LoadGrammar(new DictationGrammar());
            classicRecognition.SpeechHypothesized += (_, args) =>
            {
                lock (gate) provisional = args.Result.Text;
                Emit(new(recordingId, "transcript", Text: FullTranscript()));
            };
            classicRecognition.SpeechRecognized += (_, args) =>
            {
                lock (gate) { confirmed = Join(confirmed, args.Result.Text); provisional = ""; }
                Emit(new(recordingId, "transcript", Text: FullTranscript()));
            };
            classicRecognition.AudioLevelUpdated += (_, args) =>
                Emit(new(recordingId, "audio_level", Level: args.AudioLevel / 100f));
            classicRecognition.SetInputToDefaultAudioDevice();
            classicRecognition.RecognizeAsync(RecognizeMode.Multiple);
            Emit(new(request.Id, "engine", Backend: "windows-speech-classic"));
            Emit(new(request.Id, "started", Message: "聞き取り中"));
        }
        catch (Exception error)
        {
            classicRecognition?.Dispose();
            classicRecognition = null;
            Emit(new(request.Id, "error", Message: $"音声認識を開始できません: {error.Message}"));
        }
    }

    void Stop(int id)
    {
        if (cloudCapture is not null)
        {
            StopCloudCapture();
            Emit(new(id, "final", Text: ""));
            recordingId = 0;
            return;
        }
        try { recognition?.StopContinuousRecognition(); } catch { }
        recognition?.Dispose();
        recognition = null;
        try { classicRecognition?.RecognizeAsyncStop(); } catch { }
        classicRecognition?.Dispose();
        classicRecognition = null;
        Emit(new(id, "final", Text: FullTranscript()));
        recordingId = 0;
    }

    void StopCloudCapture()
    {
        try { cloudCapture?.StopRecording(); } catch { }
        cloudCapture?.Dispose();
        cloudCapture = null;
        lock (gate)
        {
            cloudWriter?.Dispose();
            cloudWriter = null;
        }
    }

    string FullTranscript()
    {
        lock (gate) return Join(confirmed, provisional);
    }

    static string Join(string left, string right)
    {
        if (string.IsNullOrWhiteSpace(left)) return right;
        if (string.IsNullOrWhiteSpace(right)) return left;
        return $"{left} {right}";
    }

    void ConfigureShortcuts(string[] shortcuts)
    {
        hotkey?.Dispose();
        hotkey = shortcuts.Length == 0
            ? null
            : new ModifierKeyboardHook(shortcuts, (shortcut, state) => Emit(new(0, "shortcut", Message: state, Shortcut: shortcut)));
    }

    static string SimpleRefine(string text) => Regex.Replace(
        text,
        @"\b(um|uh|you know|I mean)\b",
        "",
        RegexOptions.IgnoreCase
    ).Trim();

    static async Task<string> Refine(BridgeRequest request)
    {
        var original = request.Text ?? "";
        if (LanguageModel.GetReadyState() != AIFeatureReadyState.Ready) return SimpleRefine(original);
        try
        {
            using var languageModel = await LanguageModel.CreateAsync();
            var japanese = (request.Locale ?? "ja-JP").StartsWith("ja", StringComparison.OrdinalIgnoreCase);
            var instruction = request.Prompt?.Trim();
            if (string.IsNullOrWhiteSpace(instruction))
            {
                instruction = japanese
                    ? "音声認識結果を必要最小限に補正してください。意味や文体は変えず、整形後の本文だけを返してください。"
                    : "Correct the voice transcript minimally without changing its meaning or tone. Return only the formatted text.";
            }
            var prompt = $"""
                {instruction}

                <transcript>
                {original}
                </transcript>
                """;
            var response = await languageModel.GenerateResponseAsync(prompt);
            var refined = response.Text?.Trim() ?? "";
            return string.IsNullOrWhiteSpace(refined) ? SimpleRefine(original) : refined;
        }
        catch
        {
            return SimpleRefine(original);
        }
    }

    void Insert(string text, bool autoPaste)
    {
        var thread = new Thread(() =>
        {
            System.Windows.Forms.Clipboard.SetText(text);
            if (!autoPaste) return;
            // 録音開始時に前面だったウィンドウへ戻してからペーストする
            var window = pasteTargetWindow;
            if (window != IntPtr.Zero && window != GetForegroundWindow())
            {
                SetForegroundWindow(window);
                Thread.Sleep(150);
            }
            System.Windows.Forms.SendKeys.SendWait("^v");
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
    }

    public static void Emit(BridgeResponse response)
    {
        lock (JsonOptions.Write)
        {
            Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions.Write));
            Console.Out.Flush();
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}

static class JsonOptions
{
    public static readonly JsonSerializerOptions Read = new() { PropertyNameCaseInsensitive = true };
    public static readonly JsonSerializerOptions Write = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };
}

sealed class ModifierKeyboardHook : IDisposable
{
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100;
    const int WM_KEYUP = 0x0101;
    const int WM_SYSKEYDOWN = 0x0104;
    const int WM_SYSKEYUP = 0x0105;
    readonly Action<string, string> emit;
    readonly HashSet<string> shortcuts;
    readonly HashSet<int> pressedKeys = [];
    readonly Thread thread;
    readonly HookProc callback;
    IntPtr hook;
    uint threadId;

    public ModifierKeyboardHook(IEnumerable<string> shortcuts, Action<string, string> emit)
    {
        this.emit = emit;
        this.shortcuts = shortcuts.ToHashSet();
        callback = OnKeyboard;
        thread = new Thread(Run) { IsBackground = true };
        thread.Start();
    }

    void Run()
    {
        threadId = GetCurrentThreadId();
        hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, IntPtr.Zero, 0);
        while (GetMessage(out var message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
    }

    IntPtr OnKeyboard(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code < 0) return CallNextHookEx(hook, code, wParam, lParam);
        var key = Marshal.ReadInt32(lParam);
        var shortcut = ShortcutForKey(key);
        if (shortcut is not null && shortcuts.Contains(shortcut))
        {
            if ((wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN)
                && pressedKeys.Add(key)
                && pressedKeys.Count(pressedKey => ShortcutForKey(pressedKey) == shortcut) == 1)
            {
                emit(shortcut, "Pressed");
            }
            if ((wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP)
                && pressedKeys.Remove(key)
                && !pressedKeys.Any(pressedKey => ShortcutForKey(pressedKey) == shortcut))
            {
                emit(shortcut, "Released");
            }
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

    static string? ShortcutForKey(int key) => key switch
    {
        0x10 or 0xA0 or 0xA1 => "Shift",
        0x11 or 0xA2 or 0xA3 => "Control",
        0x12 or 0xA4 or 0xA5 => "Option",
        0x5B or 0x5C => "Command",
        _ => null,
    };

    public void Dispose()
    {
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        if (threadId != 0) PostThreadMessage(threadId, 0x0012, IntPtr.Zero, IntPtr.Zero);
    }

    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public int ptX; public int ptY; }
    [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetMessage(out MSG message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] static extern bool PostThreadMessage(uint threadId, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
}
