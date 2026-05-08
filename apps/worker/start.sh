#!/bin/bash
# Audio and display setup is best-effort — Node must start regardless so
# Cloud Run's health check passes. Audio errors surface at runtime per meeting.

# Virtual display — Chromium needs this even in "headless" mode via Playwright
Xvfb :99 -screen 0 1920x1080x24 &
echo "Xvfb started on :99 (PID $!)"

# PulseAudio — non-fatal, container may not have full audio device support
pulseaudio --start --exit-idle-time=-1 --log-target=stderr 2>/dev/null || true

# Wait up to 10s for PulseAudio to be ready before loading the null sink
for i in $(seq 1 10); do
  if pactl info &>/dev/null; then
    pactl load-module module-null-sink \
      sink_name=virtual_sink \
      sink_properties=device.description="MeetingBotSink" 2>/dev/null || true
    echo "PulseAudio null sink 'virtual_sink' ready"
    break
  fi
  sleep 1
done

export PULSE_SINK=virtual_sink
export DISPLAY=:99

exec node /app/apps/worker/dist/index.js
