#!/bin/bash
# Best-effort display and audio setup — Node must start regardless.
# All setup commands are time-bounded so they cannot hang the container.

# Virtual display — Chromium needs a display even in Playwright mode
Xvfb :99 -screen 0 1920x1080x24 &
echo "Xvfb started (PID $!)"

# PulseAudio — give it 5s max to start, then move on regardless
timeout 5 pulseaudio --start --exit-idle-time=-1 --log-target=stderr 2>/dev/null || true

# Wait up to 8s for PulseAudio socket to appear, then load null sink
PULSE_READY=0
for i in $(seq 1 8); do
  if timeout 2 pactl info &>/dev/null 2>&1; then
    timeout 3 pactl load-module module-null-sink \
      sink_name=virtual_sink \
      sink_properties=device.description="MeetingBotSink" 2>/dev/null || true
    echo "PulseAudio null sink 'virtual_sink' ready"
    PULSE_READY=1
    break
  fi
  sleep 1
done

if [ "$PULSE_READY" -eq 0 ]; then
  echo "PulseAudio not available — audio capture will fail at runtime, HTTP server starting anyway"
fi

export PULSE_SINK=virtual_sink
export DISPLAY=:99

exec node /app/apps/worker/dist/index.js
