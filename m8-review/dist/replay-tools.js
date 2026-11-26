(() => {
  const recordingTypes = [
    'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'
  ];

  function mount({
    canvas, stage, videoInput, recordButton, videoBar, offsetInput, closeVideo, ctaFullscreen,
    time, playing, speed, message, activeFightId,
  }) {
    const view = recordButton.ownerDocument || document;
    const video = videoBar.querySelector('video') || view.createElement('video');
    const recordLabel = recordButton.textContent.trim() || '录制回放';
    const fullscreenLabel = ctaFullscreen.textContent.trim() || '全屏';
    const canRecord = typeof canvas.captureStream === 'function' && typeof MediaRecorder === 'function';
    const hasFullscreen = typeof stage.requestFullscreen === 'function' ||
      typeof stage.webkitRequestFullscreen === 'function';
    let sourceUrl = '';
    let pendingPlay = null;
    let playBlocked = false;
    let recording = null;
    let disposed = false;

    if (!video.parentNode) videoBar.prepend(video);
    video.playsInline = true;
    video.preload = 'metadata';
    video.muted = true;
    videoBar.hidden = true;
    const label = videoBar.querySelector('[data-video-name]');

    function clearVideo() {
      pendingPlay = null;
      playBlocked = false;
      video.pause();
      videoBar.hidden = true;
      if (!sourceUrl) return;
      const url = sourceUrl;
      sourceUrl = '';
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      if (label) label.textContent = '';
    }

    function syncVideo() {
      if (!sourceUrl || video.readyState < 1) return;
      const offset = Number(offsetInput.value);
      const moment = Number(time()) / 1000 + (Number.isFinite(offset) ? offset : 0);
      if (!Number.isFinite(moment)) return;
      const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
      const wanted = Math.max(0, Math.min(duration, moment));
      const shouldPlay = playing() && moment >= 0 && moment < duration;
      const rate = Number(speed());
      if (Number.isFinite(rate) && rate > 0 && video.playbackRate !== rate) video.playbackRate = rate;
      const tolerance = shouldPlay && !video.paused ? .35 : .035;
      if (Math.abs(video.currentTime - wanted) > tolerance) video.currentTime = wanted;
      if (!shouldPlay) {
        playBlocked = false;
        if (!video.paused) video.pause();
      } else if (video.paused && !pendingPlay && !playBlocked) {
        const activeUrl = sourceUrl;
        pendingPlay = Promise.resolve(video.play()).catch(error => {
          if (sourceUrl === activeUrl && error?.name !== 'AbortError') playBlocked = true;
        }).finally(() => {
          if (sourceUrl === activeUrl) pendingPlay = null;
        });
      }
    }

    function openVideo() {
      const file = videoInput.files?.[0];
      videoInput.value = '';
      if (!file) return;
      if (!activeFightId()) {
        message('请先载入一场战斗，再选择本地录像。');
        return;
      }
      if (file.type && !file.type.startsWith('video/')) {
        message('请选择浏览器支持的视频文件。');
        return;
      }
      clearVideo();
      sourceUrl = URL.createObjectURL(file);
      video.src = sourceUrl;
      videoBar.hidden = false;
      if (label) label.textContent = file.name;
      syncVideo();
    }

    function videoError() {
      if (!sourceUrl) return;
      clearVideo();
      message('浏览器无法播放这个录像格式，试试 MP4 或 WebM。');
    }

    function updateRecordingButton() {
      const pressed = String(Boolean(recording));
      const disabled = !canRecord || (!recording && !activeFightId());
      if (recordButton.disabled !== disabled) recordButton.disabled = disabled;
      if (recordButton.dataset.recording !== pressed) {
        recordButton.textContent = recording ? '停止录制' : recordLabel;
        recordButton.dataset.recording = pressed;
        recordButton.setAttribute('aria-pressed', pressed);
        if (!canRecord) recordButton.title = '当前浏览器不支持画布录制';
      }
    }

    function stopRecording(save) {
      if (!recording) return;
      recording.save = save;
      if (recording.recorder.state !== 'inactive') recording.recorder.stop();
    }

    function saveDownload(item) {
      const type = item.recorder.mimeType || item.chunks[0].type || 'video/webm';
      const extension = type.includes('mp4') ? 'mp4' : 'webm';
      const file = new Blob(item.chunks, { type });
      const url = URL.createObjectURL(file);
      const download = view.createElement('a');
      download.href = url;
      download.download = item.filename + '.' + extension;
      download.click();
      // Downloads may claim the URL after the click returns.
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function toggleRecording() {
      if (recording) {
        stopRecording(true);
        return;
      }
      const fight = activeFightId();
      if (!fight || !canRecord) return;
      let stream;
      try {
        stream = canvas.captureStream(30);
        const mimeType = typeof MediaRecorder.isTypeSupported === 'function'
          ? recordingTypes.find(type => MediaRecorder.isTypeSupported(type)) : undefined;
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        const filename = 'M8-战斗' + String(fight).replace(/[^\w-]/g, '') + '-回放';
        const item = { recorder, chunks: [], save: true, filename };
        recorder.addEventListener('dataavailable', event => {
          if (event.data?.size) item.chunks.push(event.data);
        });
        recorder.addEventListener('error', () => {
          item.save = false;
          if (!disposed) message('回放录制中断，请重新尝试。');
        });
        recorder.addEventListener('stop', () => {
          for (const track of stream.getTracks()) track.stop();
          if (recording === item) recording = null;
          if (disposed) return;
          updateRecordingButton();
          if (item.save && item.chunks.length) saveDownload(item);
        }, { once: true });
        recorder.start(1000);
        recording = item;
        updateRecordingButton();
      } catch {
        if (stream) for (const track of stream.getTracks()) track.stop();
        message('无法开始画布录制，请检查浏览器是否允许录制。');
      }
    }

    function fullscreenElement() {
      return view.fullscreenElement || view.webkitFullscreenElement;
    }

    function updateFullscreenButton() {
      const active = fullscreenElement() === stage;
      ctaFullscreen.disabled = !hasFullscreen;
      ctaFullscreen.textContent = active ? '退出全屏' : fullscreenLabel;
      ctaFullscreen.setAttribute('aria-pressed', String(active));
      if (!hasFullscreen) ctaFullscreen.title = '当前浏览器不支持页面全屏';
    }

    async function toggleFullscreen() {
      try {
        if (fullscreenElement() === stage) {
          const exit = view.exitFullscreen || view.webkitExitFullscreen;
          if (exit) await exit.call(view);
        } else {
          const enter = stage.requestFullscreen || stage.webkitRequestFullscreen;
          if (enter) await enter.call(stage);
        }
        updateFullscreenButton();
      } catch {
        message('浏览器没有允许这个回放进入全屏。');
      }
    }

    const listeners = [
      [videoInput, 'change', openVideo], [offsetInput, 'input', syncVideo], [closeVideo, 'click', clearVideo],
      [video, 'loadedmetadata', syncVideo], [video, 'error', videoError], [recordButton, 'click', toggleRecording],
      [ctaFullscreen, 'click', toggleFullscreen], [view, 'fullscreenchange', updateFullscreenButton],
      [view, 'webkitfullscreenchange', updateFullscreenButton],
    ];
    for (const [target, type, callback] of listeners) target.addEventListener(type, callback);
    updateRecordingButton();
    updateFullscreenButton();

    return {
      update() {
        if (disposed) return;
        syncVideo();
        updateRecordingButton();
      },
      reset() {
        clearVideo();
        offsetInput.value = '0';
        stopRecording(true);
        updateRecordingButton();
      },
      destroy() {
        for (const [target, type, callback] of listeners) target.removeEventListener(type, callback);
        disposed = true;
        clearVideo();
        stopRecording(false);
      },
    };
  }

  globalThis.M8ReplayTools = { mount };
})();
