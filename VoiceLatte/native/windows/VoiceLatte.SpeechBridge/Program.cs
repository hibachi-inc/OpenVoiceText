using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Globalization;
using System.Speech.Recognition;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Windows.AI;
using Microsoft.Windows.AI.Speech;
using Microsoft.Windows.AI.Text;
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
    string? DeviceUID,
    bool? MuteOtherAudio,
    string? Permission,
    bool? AutoPaste
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
    readonly object gate = new();
    int recordingId;
    string confirmed = "";
    string provisional = "";

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
            case "configure_shortcut": ConfigureShortcut(request.Shortcut ?? "Control"); Emit(new(request.Id, "ready")); break;
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
        Emit(new(id, "context", AppName: name, Category: category, PromptKey: name));
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
        if (!await EnsureModel(request.Id, emitErrors: false))
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
        try { recognition?.StopContinuousRecognition(); } catch { }
        recognition?.Dispose();
        recognition = null;
        try { classicRecognition?.RecognizeAsyncStop(); } catch { }
        classicRecognition?.Dispose();
        classicRecognition = null;
        Emit(new(id, "final", Text: FullTranscript()));
        recordingId = 0;
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

    void ConfigureShortcut(string shortcut)
    {
        hotkey?.Dispose();
        hotkey = string.IsNullOrEmpty(shortcut)
            ? null
            : new ModifierKeyboardHook(shortcut, state => Emit(new(0, "shortcut", Message: state)));
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
            var categoryHint = request.Category is "code" or "terminal"
                ? "技術用語、識別子、コマンド、フラグ、パスは変更しないでください。"
                : "";
            var prompt = $"""
                以下の音声文字起こしを整形してください。言い換え、要約、補足、文体変更、語順変更はせず、
                フィラーを削除し、句読点と数字・金額・日付・単位だけを自然な表記に整えてください。
                {categoryHint}
                ユーザー指示: {request.Prompt ?? ""}
                整形後の本文だけを返してください。

                {original}
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

    static void Insert(string text, bool autoPaste)
    {
        var thread = new Thread(() =>
        {
            System.Windows.Forms.Clipboard.SetText(text);
            if (autoPaste) System.Windows.Forms.SendKeys.SendWait("^v");
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

    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
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
    readonly Action<string> emit;
    readonly int virtualKey;
    readonly Thread thread;
    readonly HookProc callback;
    IntPtr hook;
    uint threadId;

    public ModifierKeyboardHook(string shortcut, Action<string> emit)
    {
        this.emit = emit;
        virtualKey = shortcut switch { "Option" => 0x12, "Command" => 0x5B, "Shift" => 0x10, _ => 0x11 };
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
        if (code >= 0 && Marshal.ReadInt32(lParam) == virtualKey)
        {
            if (wParam == (IntPtr)WM_KEYDOWN) emit("Pressed");
            if (wParam == (IntPtr)WM_KEYUP) emit("Released");
        }
        return CallNextHookEx(hook, code, wParam, lParam);
    }

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
