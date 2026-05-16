import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { 
  Mic, 
  Link as LinkIcon, 
  FileUp, 
  Sparkles, 
  Languages, 
  Share, 
  Download, 
  Copy, 
  Keyboard, 
  Send,
  Globe,
  Radio,
  LayoutGrid,
  BarChart2,
  FileText,
  Loader2
} from 'lucide-react';

export default function App() {
  const [outputMode, setOutputMode] = useState('A');
  const [isRecording, setIsRecording] = useState(false);
  const [hasTranscript, setHasTranscript] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcriptText, setTranscriptText] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(24).fill(16));
  
  const [activeInputType, setActiveInputType] = useState<['none', 'youtube', 'file'][number]>('none');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<'EN' | 'فصحى' | 'عامية'>('عامية');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsProcessing(true);
    setHasTranscript(false);
    setTranscriptText('');
    setRecordingSeconds(0);
    setActiveInputType('none');

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64data = reader.result as string;
      const base64String = base64data.split(',')[1];
      await processAudio(base64String, file.type);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const toggleRecording = async () => {
    if (isProcessing) return;

    if (isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
      setIsRecording(false);
      setIsProcessing(true);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        
        // Setup Audio Analyser
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          const audioCtx = new AudioContextClass();
          audioContextRef.current = audioCtx;
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          const source = audioCtx.createMediaStreamSource(stream);
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateVisualizer = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            
            const levels = Array.from({length: 24}).map((_, i) => {
              const binIndex = Math.floor(i * (dataArray.length / 24));
              const val = dataArray[binIndex] || 0;
              return 16 + (val / 255) * 48; // Max height ~64px
            });
            setAudioLevels(levels);
            animationFrameRef.current = requestAnimationFrame(updateVisualizer);
          };
          updateVisualizer();
        }

        const mediaRecorder = new MediaRecorder(stream);
        mediaRecorderRef.current = mediaRecorder;
        chunksRef.current = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          chunksRef.current = [];
          
          const reader = new FileReader();
          reader.readAsDataURL(blob);
          reader.onloadend = async () => {
            const base64data = reader.result as string;
            const base64String = base64data.split(',')[1];
            await processAudio(base64String, 'audio/webm');
          };
        };

        mediaRecorder.start();
        setIsRecording(true);
        setHasTranscript(false);
        setTranscriptText("");
        setRecordingSeconds(0);
        timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
      } catch (err) {
        console.error("Error accessing microphone:", err);
      }
    }
  };

  const formatTime = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const [chatMessage, setChatMessage] = useState("");

  const performAction = async (action: string) => {
    if (!transcriptText || isProcessing) return;
    
    if (action === 'export') {
      const blob = new Blob([transcriptText], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'transcript.txt';
      a.click();
      URL.revokeObjectURL(url);
      return;
    }

    setIsProcessing(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key logic is missing or the API Key is invalid.");
      const ai = new GoogleGenAI({ apiKey });
      
      let prompt = '';
      if (action === 'improve') prompt = "حسّن صياغة هذا النص وقم بتصحيح الأخطاء الإملائية والنحوية دون تغيير المعنى:";
      if (action === 'translate') prompt = "Translate the following text to English (if Arabic) or Arabic (if English):";
      if (action === 'post') prompt = "حول هذا النص إلى منشور جذاب لمنصات التواصل الاجتماعي:";
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `${prompt}\n\n${transcriptText}`
      });

      setTranscriptText(response.text || transcriptText);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChatSend = async () => {
    if (!chatMessage || !transcriptText || isProcessing) return;
    setIsProcessing(true);
    const currentMessage = chatMessage;
    setChatMessage("");
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key logic is missing");
      const ai = new GoogleGenAI({ apiKey });
      
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `أنت مساعد ذكي للنصوص. النص الأصلي هو:\n${transcriptText}\n\nطلب المستخدم: ${currentMessage}\n\nقم بتنفيذ طلب المستخدم على النص الأصلي.`
      });

      setTranscriptText(response.text || transcriptText);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };
  const languageMap = {
    'عامية': 'Egyptian Arabic Dialect (العامية المصرية)',
    'فصحى': 'Modern Standard Arabic (الفصحى)',
    'EN': 'English'
  };

  const outputModeInstructions: Record<string, string> = {
    'A': "Output mode: Clean Transcript (Mode A). Output the full transcription with punctuation.",
    'B': "Output mode: Analysis (Mode B). Add time markers and format as structured analysis.",
    'C': "Output mode: Transcript/Meeting Minutes (Mode C). Output meeting minutes format with main points and action items."
  };

  const processYoutubeUrl = async (url: string) => {
    if (!url) return;
    setIsProcessing(true);
    setActiveInputType('none');
    setHasTranscript(false);
    setTranscriptText('');
    setRecordingSeconds(0);
    
    // Start dummy timer for visual feedback
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         throw new Error("API Key logic is missing or the API Key is invalid.");
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const promptText = `
You are TranscribeAR, an AI-powered voice transcription engine.
Transcribe this YouTube video EXACTLY as spoken.
Focus on ${languageMap[selectedLanguage]}.
Do NOT translate or summarize or format as markdown unless asked.
${outputModeInstructions[outputMode] || outputModeInstructions.A}
`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `${promptText}\n\nVideo URL: ${url}`,
        config: {
          tools: [{ urlContext: {} }]
        }
      });

      setTranscriptText(response.text || "");
      setHasTranscript(true);
    } catch (err) {
      console.error("Transcription error:", err);
      setTranscriptText("حدث خطأ أثناء التفريغ. تأكد من صحة الرابط أو جرب رابطاً آخر.");
      setHasTranscript(true);
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setIsProcessing(false);
    }
  };

  const processAudio = async (base64Audio: string, mimeType: string) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
         throw new Error("API Key logic is missing or the API Key is invalid.");
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const promptText = `
You are TranscribeAR, an AI-powered voice transcription engine.
Transcribe this audio EXACTLY as spoken.
Focus on ${languageMap[selectedLanguage]}.
Do NOT translate or summarize or format as markdown unless asked.
${outputModeInstructions[outputMode] || outputModeInstructions.A}
`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              { text: promptText }
            ]
          }
        ]
      });

      setTranscriptText(response.text || "");
      setHasTranscript(true);
    } catch (err) {
      console.error("Transcription error:", err);
      setTranscriptText("حدث خطأ أثناء التفريغ. تأكد من إعدادات الميكروفون أو جودة الصوت وحاول مجدداً.");
      setHasTranscript(true);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0b1120] text-slate-100 overflow-hidden font-sans">
      
      {/* Sidebar (Right side in RTL) */}
      <aside className="w-[320px] shrink-0 border-l border-slate-800/60 bg-[#0f172a]/40 flex flex-col p-6 overflow-y-auto">
        <div className="text-2xl font-bold mb-10 tracking-tight text-white flex items-center gap-2">
          TranscribeAR
        </div>

        <div className="mb-8">
          <div className="text-xs font-semibold text-slate-500 tracking-widest mb-4 uppercase">Output Mode</div>
          <div className="space-y-2">
            <ModeButton 
              active={outputMode === 'A'} 
              onClick={() => setOutputMode('A')}
              letter="A"
              icon={<LayoutGrid className="w-4 h-4" />}
              label="Overview"
            />
            <ModeButton 
              active={outputMode === 'B'} 
              onClick={() => setOutputMode('B')}
              letter="B"
              icon={<BarChart2 className="w-4 h-4" />}
              label="Analysis"
            />
            <ModeButton 
              active={outputMode === 'C'} 
              onClick={() => setOutputMode('C')}
              letter="C"
              icon={<FileText className="w-4 h-4" />}
              label="Transcript"
            />
          </div>
        </div>

        <div className="mb-8">
          <div className="text-xs font-semibold text-slate-500 tracking-widest mb-4 uppercase">Quick Actions</div>
          <div className="grid grid-cols-2 gap-3">
            <ActionButton onClick={() => performAction('improve')} icon={<Sparkles className="w-4 h-4" />} label="Improve" />
            <ActionButton onClick={() => performAction('translate')} icon={<Languages className="w-4 h-4" />} label="Translate" />
            <ActionButton onClick={() => performAction('export')} icon={<Download className="w-4 h-4" />} label="Export" />
            <ActionButton onClick={() => performAction('post')} icon={<Share className="w-4 h-4" />} label="Post" />
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 tracking-widest mb-4 uppercase">Recent History</div>
          {/* History items can go here */}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#0b1120]">
        
        {/* Header */}
        <header className="h-20 px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-6">
            {/* Status */}
            <div className="flex items-center gap-3">
              <Radio className="w-5 h-5 text-slate-400" />
              <Globe className="w-5 h-5 text-slate-400" />
              <div className="flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-3 py-1.5 rounded-full text-sm font-medium border border-emerald-500/20">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                متصل
              </div>
            </div>
          </div>
          
          {/* Language Toggle */}
          <div className="flex items-center bg-slate-800/50 p-1 rounded-full border border-slate-700/50">
            <button 
              onClick={() => setSelectedLanguage('عامية')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${selectedLanguage === 'عامية' ? 'bg-blue-500 text-white rounded-full shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-white'}`}
            >
              عامية
            </button>
            <button 
              onClick={() => setSelectedLanguage('فصحى')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${selectedLanguage === 'فصحى' ? 'bg-blue-500 text-white rounded-full shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-white'}`}
            >
              فصحى
            </button>
            <button 
              onClick={() => setSelectedLanguage('EN')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${selectedLanguage === 'EN' ? 'bg-blue-500 text-white rounded-full shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:text-white'}`}
            >
              EN
            </button>
          </div>
        </header>

        {/* Scrollable Center */}
        <main className="flex-1 overflow-y-auto px-8 pb-32">
          <div className="max-w-4xl mx-auto space-y-6 pt-4">
            
            {/* Big Recording Area */}
            <div 
              className={`relative overflow-hidden border border-slate-800/80 rounded-2xl bg-gradient-to-b from-slate-900/40 to-slate-900/10 ${hasTranscript ? 'p-8' : 'p-12'} flex flex-col items-center justify-center transition-all duration-500 cursor-pointer ${isRecording ? 'border-red-500/50 shadow-[0_0_40px_-10px_rgba(239,68,68,0.2)]' : isProcessing ? 'border-blue-500/50 shadow-[0_0_40px_-10px_rgba(59,130,246,0.2)]' : 'hover:border-slate-700'}`}
              onClick={!isProcessing ? toggleRecording : undefined}
            >
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02]" />
              
              <div className={`bg-slate-800/80 rounded-2xl border border-slate-700 flex items-center justify-center relative z-10 transition-all ${hasTranscript ? 'w-12 h-12 mb-4' : 'w-16 h-16 mb-6'}`}>
                <Mic className={`${hasTranscript ? 'w-6 h-6' : 'w-8 h-8'} ${isRecording ? 'text-red-400' : isProcessing ? 'text-blue-400' : 'text-slate-400'}`} />
                {isRecording && (
                  <span className="absolute top-0 right-0 -mt-1 -mr-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                )}
              </div>
              
              {/* Status and Time Display */}
              {isRecording ? (
                <div className="flex flex-col items-center mb-6 relative z-10">
                  <div className="flex items-center gap-3 bg-red-500/10 text-red-500 px-5 py-2 rounded-full border border-red-500/20 mb-3 shadow-[0_0_20px_-5px_rgba(239,68,68,0.3)]">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono font-semibold tracking-widest text-lg" dir="ltr">{formatTime(recordingSeconds)}</span>
                  </div>
                  <h2 className="text-[15px] font-medium text-slate-400">انقر للإيقاف والبدء في المعالجة</h2>
                </div>
              ) : isProcessing ? (
                <div className="flex flex-col items-center mb-6 relative z-10">
                  <div className="flex items-center gap-3 bg-blue-500/10 text-blue-400 px-5 py-2 rounded-full border border-blue-500/20 mb-3 shadow-[0_0_20px_-5px_rgba(59,130,246,0.3)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="font-mono font-semibold tracking-widest text-lg" dir="ltr">{formatTime(recordingSeconds)}</span>
                  </div>
                  <h2 className="text-[15px] font-medium text-slate-400">جاري تحليل الصوت وتفريغه بذكاء...</h2>
                </div>
              ) : (
                <h2 className={`${hasTranscript ? 'text-[15px] text-slate-400' : 'text-xl text-slate-200'} font-medium mb-6 relative z-10`}>
                  اضغط للتسجيل المباشر
                </h2>
              )}

              {/* Soundwaves */}
              <div className={`flex items-center gap-1.5 ${hasTranscript ? 'h-10' : 'h-16'}`}>
                {audioLevels.map((level, i) => (
                  <motion.div
                    key={i}
                    animate={{ 
                       height: isProcessing 
                         ? [16, Math.random() * 30 + 10, 16] 
                         : isRecording ? level : (hasTranscript ? 10 : 16) 
                    }}
                    transition={isProcessing ? {
                      repeat: Infinity,
                      duration: 0.8,
                      delay: i * 0.05,
                      ease: "easeInOut"
                    } : {
                      type: "tween", duration: 0.05
                    }}
                    className={`w-1.5 rounded-full ${isRecording ? 'bg-red-500' : isProcessing ? 'bg-blue-400' : 'bg-slate-700'}`}
                  />
                ))}
              </div>
            </div>

            {activeInputType === 'youtube' ? (
              <div className="border border-indigo-500/50 bg-indigo-500/5 rounded-2xl p-8 relative flex flex-col items-center">
                <LinkIcon className="w-10 h-10 text-indigo-400 mb-4" />
                <h3 className="text-xl font-bold text-slate-200 mb-6">أدخل رابط فيديو يوتيوب</h3>
                <div className="flex w-full max-w-2xl gap-3">
                  <input
                    type="url"
                    dir="ltr"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="flex-1 h-14 bg-slate-900/80 border border-slate-700 focus:border-indigo-500 rounded-xl px-4 text-slate-200 placeholder:text-slate-500 outline-none transition-all text-left"
                    autoFocus
                    onKeyDown={(e) => { 
                      if (e.key === 'Enter') processYoutubeUrl(youtubeUrl);
                    }}
                  />
                  <button 
                    onClick={() => processYoutubeUrl(youtubeUrl)}
                    disabled={!youtubeUrl || isProcessing}
                    className="h-14 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors text-white font-medium shadow-lg shadow-indigo-500/20"
                  >
                    تفريغ
                  </button>
                </div>
                <button 
                  onClick={() => setActiveInputType('none')}
                  className="mt-6 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  إلغاء
                </button>
              </div>
            ) : hasTranscript ? (
              <>
                {/* Stats row for Transcript mode */}
                <div className="grid grid-cols-3 gap-6">
                  <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-6 text-center">
                    <div className="text-sm font-medium text-slate-400 mb-2">المدة</div>
                    <div className="text-3xl font-bold text-white font-mono">{formatTime(recordingSeconds)}</div>
                  </div>
                  <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-6 text-center">
                    <div className="text-sm font-medium text-slate-400 mb-2">الكلمات</div>
                    <div className="text-3xl font-bold text-white font-mono">{transcriptText.split(/\s+/).filter(w => w.length > 0).length}</div>
                  </div>
                  <div className="border border-slate-800 bg-slate-900/30 rounded-2xl p-6 text-center">
                    <div className="text-sm font-medium text-slate-400 mb-2">الدقة</div>
                    <div className="text-3xl font-bold text-white font-mono">97%</div>
                  </div>
                </div>

                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => fileInputRef.current?.click()} className="px-6 py-2.5 rounded-full border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition-colors flex items-center gap-2 mt-4 sm:mt-0">
                    <FileUp className="w-4 h-4" /> رفع ملف
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="audio/*,video/*" 
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => setActiveInputType('youtube')}
                    className="px-6 py-2.5 rounded-full border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition-colors flex items-center gap-2"
                  >
                    <LinkIcon className="w-4 h-4" /> رابط يوتيوب
                  </button>
                  <button 
                    onClick={() => performAction('translate')}
                    className="px-6 py-2.5 rounded-full border border-slate-700 bg-slate-800/50 hover:bg-slate-800 text-slate-300 transition-colors flex items-center gap-2 mt-4 sm:mt-0"
                  >
                    <Languages className="w-4 h-4" /> ترجمة
                  </button>
                </div>
              </>
            ) : (
              /* Input Options */
              <div className="grid grid-cols-3 gap-6">
                <InputCard 
                  icon={<LinkIcon className="w-5 h-5 text-indigo-400" />}
                  title="رابط يوتيوب"
                  desc="الصق رابط الفيديو وسنقوم باستخراج النص لك."
                  onClick={() => setActiveInputType('youtube')}
                />
                <InputCard 
                  icon={<FileUp className="w-5 h-5 text-amber-400" />}
                  title="ارفع ملف 📁"
                  desc="يدعم ملفات WAV, MP3, و MP4 حتى 500 ميجابايت."
                  onClick={() => fileInputRef.current?.click()}
                />
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="audio/*,video/*" 
                  onChange={handleFileUpload}
                />
                <InputCard 
                  icon={<Mic className="w-5 h-5 text-emerald-400" />}
                  title="سجل مباشرة 🎤"
                  desc="ابدأ تحويل صوتك إلى نص فوراً وبدقة عالية."
                  onClick={toggleRecording}
                />
              </div>
            )}

            {/* Result Transcript */}
            <div className="border border-slate-800/80 bg-[#111827]/60 rounded-2xl p-8 relative">
              <button 
                className="absolute top-6 left-6 flex items-center gap-2 bg-slate-800 hover:bg-slate-700 transition-colors text-slate-300 px-4 py-2 rounded-lg text-sm font-medium border border-slate-700/50"
                onClick={() => navigator.clipboard.writeText(transcriptText)}
              >
                نسخ النص
                <Copy className="w-4 h-4" />
              </button>
              
              <div className="flex items-center gap-4 mb-6">
                <div className="w-1.5 h-8 bg-blue-500 rounded-full" />
                <h3 className="text-xl font-bold text-white">النص المستخرج</h3>
              </div>

              <div className="text-slate-300 text-lg leading-relaxed space-y-6">
                <p className="whitespace-pre-wrap">
                  {transcriptText}
                </p>
              </div>
            </div>
            
            <div className="h-10" />

          </div>
        </main>

        {/* Bottom Input Area */}
        <div className="border-t border-slate-800/80 bg-[#0b1120] p-6 shrink-0 z-20">
          <div className="max-w-4xl mx-auto flex gap-4">
            <button className="w-12 h-14 flex items-center justify-center shrink-0 rounded-xl bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors border border-slate-700/50">
              <Keyboard className="w-6 h-6" />
            </button>
            <div className="flex-1 relative">
              <input 
                type="text" 
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChatSend();
                }}
                disabled={isProcessing}
                placeholder="اطلب من الذكاء الاصطناعي تحسين النص أو تلخيصه ..."
                className="w-full h-14 bg-slate-900/50 border border-slate-800 focus:border-slate-600 rounded-xl px-6 text-slate-200 placeholder:text-slate-500 outline-none transition-all text-lg disabled:opacity-50"
              />
            </div>
            <button 
              onClick={handleChatSend}
              disabled={isProcessing || !chatMessage.trim()}
              className="h-14 px-8 flex items-center justify-center gap-3 shrink-0 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-colors text-white font-medium text-lg shadow-lg shadow-blue-500/20"
            >
              إرسال
              <Send className="w-5 h-5 rtl:-scale-x-100" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

// Subcomponents
function ModeButton({ active, letter, icon, label, onClick }: { active: boolean, letter: string, icon: React.ReactNode, label: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center p-3 rounded-xl transition-all duration-200 cursor-pointer ${active ? 'bg-slate-800 border border-slate-700' : 'hover:bg-slate-800/50 border border-transparent'}`}
    >
      <div className={`w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold me-3 shrink-0 ${active ? 'bg-slate-700 text-slate-200' : 'bg-slate-800/80 text-slate-400'}`}>
        {letter}
      </div>
      <div className="flex items-center justify-between w-full text-sm font-medium">
        <span className={active ? 'text-white' : 'text-slate-400'}>{label}</span>
        <div className={active ? 'text-blue-400' : 'text-slate-500'}>
          {icon}
        </div>
      </div>
    </button>
  );
}

function ActionButton({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-3 p-4 rounded-xl border border-slate-800 bg-slate-900/30 hover:bg-slate-800 transition-colors text-slate-300 hover:text-white group">
      <div className="text-slate-400 group-hover:text-blue-400 transition-colors">
        {icon}
      </div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function InputCard({ icon, title, desc, onClick }: { icon: React.ReactNode, title: string, desc: string, onClick?: () => void }) {
  return (
    <button onClick={onClick} className="text-right flex flex-col items-center p-6 rounded-2xl border border-slate-800/60 bg-gradient-to-b from-slate-900/30 to-transparent hover:border-slate-700 hover:bg-slate-900/50 transition-all duration-300 group">
      <div className="w-12 h-12 rounded-xl bg-slate-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <h3 className="text-lg font-bold text-slate-200 mb-2">{title}</h3>
      <p className="text-sm text-slate-400 text-center leading-relaxed font-medium">
        {desc}
      </p>
    </button>
  );
}

