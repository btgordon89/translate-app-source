#!/usr/bin/env python3
"""
Local Faster-Whisper Transcription Script
Optimized for speed with small model for real-time translation app
"""

import sys
import json
import time
import tempfile
import os
from pathlib import Path

def main():
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print(json.dumps({"error": "Usage: python local_transcribe.py <audio_file_path> [model_size]"}))
        sys.exit(1)
    
    audio_file_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) == 3 else "small"  # Default to small for GPU
    
    try:
        # Import faster-whisper (will fail if not installed)
        from faster_whisper import WhisperModel
        
        start_time = time.time()
        
        # Check for GPU availability and use GPU if available
        import torch
        cuda_available = torch.cuda.is_available()
        # Enable GPU acceleration with cuDNN libraries installed
        device = "cuda" if cuda_available else "cpu"
        compute_type = "float16" if cuda_available else "int8"  # Use float16 for GPU, int8 for CPU
        
        print(f"CUDA available: {cuda_available}, using device: {device}, compute_type: {compute_type}, model: {model_size}", file=sys.stderr)
        
        # Initialize model with GPU acceleration if available
        model = WhisperModel(
            model_size, 
            device=device,
            compute_type=compute_type,
            download_root=None,  # Use default cache
            local_files_only=False  # Allow downloading if needed
        )
        
        model_load_time = time.time()
        
        # Balanced settings for accuracy while preventing loops
        beam_size = 5 if cuda_available else 1  # Higher beam size for better accuracy on GPU
        vad_filter = True if cuda_available else False  # Enable VAD for better audio processing
        temperature = 0.0  # Keep deterministic
        
        print(f"[DEBUG] Transcription settings: device={device}, compute_type={compute_type}, beam_size={beam_size}, vad_filter={vad_filter}, temperature={temperature}", file=sys.stderr)
        sys.stderr.flush()  # Force stderr flush
        
        # More aggressive settings to prevent loops
        segments, info = model.transcribe(
            audio_file_path,
            beam_size=beam_size,
            language="en",  # Assume English for speed (can be made dynamic)
            condition_on_previous_text=False,  # Disable to prevent loop propagation
            vad_filter=vad_filter,
            temperature=temperature,
            compression_ratio_threshold=2.4,  # Default threshold for better balance
            log_prob_threshold=-1.0,  # Default threshold for better accuracy
            no_speech_threshold=0.6,  # Default threshold for better speech detection
            initial_prompt=None  # Remove prompt to avoid contaminating output
        )
        
        transcription_start_time = time.time()
        
        # Collect all segments with repetition detection
        transcribed_text = ""
        segments_processed = 0
        last_segment_text = ""
        repetition_count = 0
        
        print(f"[DEBUG] Processing transcription segments...", file=sys.stderr)
        sys.stderr.flush()
        
        for segment in segments:
            segments_processed += 1
            segment_text = segment.text.strip()
            
            # Check for repetitive content
            if segment_text == last_segment_text:
                repetition_count += 1
                print(f"[WARNING] Repetitive segment detected (count: {repetition_count}): '{segment_text[:50]}'", file=sys.stderr)
                sys.stderr.flush()
                if repetition_count >= 4:  # Stop after 4 identical segments (less aggressive)
                    print(f"[WARNING] Breaking due to excessive repetition", file=sys.stderr)
                    sys.stderr.flush()
                    break
            else:
                repetition_count = 0
                last_segment_text = segment_text
            
            # Add segment if it's not empty and not too repetitive
            if segment_text and len(segment_text) > 2:
                transcribed_text += segment_text + " "
        
        transcribed_text = transcribed_text.strip()
        
        print(f"[DEBUG] Processed {segments_processed} segments, final text length: {len(transcribed_text)}", file=sys.stderr)
        sys.stderr.flush()
        
        # Check if result is suspiciously repetitive
        words = transcribed_text.split()
        if len(words) > 10:
            unique_words = set(words)
            repetition_ratio = len(words) / len(unique_words) if unique_words else 0
            if repetition_ratio > 3:  # Lower threshold - more aggressive
                print(f"[WARNING] High repetition ratio detected: {repetition_ratio:.2f}", file=sys.stderr)
                sys.stderr.flush()
                # Truncate to first reasonable portion
                transcribed_text = " ".join(words[:min(50, len(words)//3)])
                print(f"[WARNING] Truncated to: '{transcribed_text}'", file=sys.stderr)
                sys.stderr.flush()
        
        end_time = time.time()
        
        # Return results as JSON with GPU info
        result = {
            "text": transcribed_text,
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "device": device,
            "compute_type": compute_type,
            "model_size": model_size,
            "beam_size": beam_size,
            "vad_filter": vad_filter,
            "cuda_available": cuda_available,
            "timing": {
                "model_load_ms": int((model_load_time - start_time) * 1000),
                "transcription_ms": int((end_time - transcription_start_time) * 1000),
                "total_ms": int((end_time - start_time) * 1000)
            }
        }
        
        print(json.dumps(result))
        
    except ImportError as e:
        print(json.dumps({
            "error": "faster-whisper not installed", 
            "details": str(e),
            "install_command": "pip install faster-whisper"
        }))
        sys.exit(1)
        
    except Exception as e:
        print(json.dumps({
            "error": "Transcription failed", 
            "details": str(e),
            "audio_file": audio_file_path
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
