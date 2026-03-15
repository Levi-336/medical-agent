"use client";

import { useState, useRef } from "react";
import { getMeralionUploadUrl, transcribeAudioWithMeralion } from "@/lib/ai";

export default function VoiceInput({ onTextRecognized }: { onTextRecognized: (text: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const toggleRecording = async () => {
    if (isProcessing) return;

    if (isRecording) {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setIsRecording(false);
      return;
    }

    try {
      if (!navigator.mediaDevices) {
        console.error("MediaDevices API is not available.");
        return alert("Microphone permission is not available in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        setIsProcessing(true);
        const mimeType = mediaRecorderRef.current?.mimeType || 'audio/wav';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        if (audioBlob.size < 1000) {
          alert("The recording is too short. Please try again.");
          setIsProcessing(false);
          return;
        }
        await processVoice(audioBlob, mimeType);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Unable to access microphone permission:", error);
      alert("Unable to access microphone permission.");
    }
  };

  const processVoice = async (audioBlob: Blob, mimeType: string) => {
    try {
      const fileExtension = mimeType.split('/')[1] || 'wav';
      const { url, fileKey } = await getMeralionUploadUrl(`voice_${Date.now()}.${fileExtension}`, audioBlob.size, mimeType);
      console.log("Upload URL:", url);
      const response = await fetch(url, { method: "PUT", headers: { "Content-Type": mimeType }, body: audioBlob });
      if (!response.ok) {
        throw new Error(`Audio upload failed with status ${response.status}`);
      }
      console.log("Audio upload succeeded, file key:", fileKey);
      const text = await transcribeAudioWithMeralion(fileKey);
      console.log("Speech recognition result:", text);
      if (text && text.trim()) onTextRecognized(text);
    } catch (error: any) {
      console.error("Voice processing failed:", error);
      if (error.message.includes('404')) {
        alert("The speech recognition service is temporarily unavailable. Please try again later or type your message.");
      } else {
        alert("Speech recognition failed. Please try again later.");
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={toggleRecording}
      disabled={isProcessing}
      title={isRecording ? "Click to stop recording" : "Click to start recording"}
      className={`flex items-center justify-center w-11 h-11 rounded-full transition-all shrink-0 ${
        isRecording
          ? "bg-red-500 text-white animate-pulse shadow-lg"
          : isProcessing
            ? "bg-[#54656f] text-[#8696a0]"
            : "bg-[#2a3942] text-[#8696a0] hover:bg-[#374045] hover:text-[#e9edef]"
      }`}
    >
      {isProcessing ? (
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : (
        <span className="material-symbols-outlined !text-[20px]">
          {isRecording ? 'stop' : 'mic'}
        </span>
      )}
    </button>
  );
}
