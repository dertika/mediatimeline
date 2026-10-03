/** Four seconds of a black 16×16 video at 1 fps, without audio (H.264 and VP8). */
const BLANK_MP4 = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMzbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAD6AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAl10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAA+gAAAAAAABAAAAAAHVbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAABAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABgG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAUBzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAVGAAAFRgAAABhzdHRzAAAAAAAAAAEAAAAEAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAEAAAAAQAAACRzdHN6AAAAAAAAAAAAAAAEAAAChgAAAAoAAAAKAAAACQAAABRzdGNvAAAAAAAAAAEAAANjAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY2MC4xNi4xMDAAAAAIZnJlZQAAAqttZGF0AAACcAYF//9s3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NCByMzEwOCAzMWUxOWY5IC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyMyAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTAgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MToweDExMSBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MCBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MSBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA5liIQF////D0UAAVefgAAAAAZBmjgL+oAAAAAGQZpUAt6gAAAABUGaYBX1";
const BLANK_WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAIzEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggId7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiECvQAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYhuPgQ8ixElzZyBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhDuaygDgibCBELqBEJqBAhJUw2f8c3OgY8CAZ8iaRaOHRU5DT0RFUkSHjUxhdmY2MC4xNi4xMDBzc9ZjwItjxYhuPgQ8ixElzWfIoUWjh0VOQ09ERVJEh5RMYXZjNjAuMzEuMTAyIGxpYnZweGfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDQuMDAwMDAwMDAwAB9DtnX554EAo6OBAACAEAIAnQEqEAAQAABHCIWFiJmEiAICAAwNYAD+/6tQgKOZgQPoALEBAAEQEAAYADA/9AwAAAD+/6tQgKOZgQfQALEBAAEQEAAYADA/9AwAAAD+/6tQgKOZgQu4ALEBAAEQEAAYADA/9AwAAAD+/6tQgBxTu2uRu4+zgQC3iveBAfGCAZ/wgQM=";

/**
 * Keeps the screen on until the returned function is called.
 *
 * Uses the Screen Wake Lock API (iOS 16.4+, Chrome) and requests it again
 * whenever the browser drops it while the page is visible. Some browsers lack
 * the API or refuse it (e.g. Opera on Android), so a muted, invisible video
 * loops alongside: Chromium keeps the screen on while a video plays that is
 * visible and large enough, which is why it covers the whole container.
 */
export function keepScreenOn(container: HTMLElement): () => void {
  let stopped = false;
  let sentinel: WakeLockSentinel | null = null;

  const video = document.createElement("video");
  const sources: [string, string][] = [
    [BLANK_MP4, "video/mp4"],
    [BLANK_WEBM, "video/webm"],
  ];
  for (const [src, type] of sources) {
    const source = document.createElement("source");
    source.src = src;
    source.type = type;
    video.append(source);
  }
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.disableRemotePlayback = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  // opacity 0 still counts as visible for IntersectionObserver.
  video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-1";
  container.prepend(video);

  const request = async () => {
    if (stopped || document.hidden || sentinel || !navigator.wakeLock) return;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (stopped) return void lock.release().catch(() => {});
      sentinel = lock;
      lock.addEventListener("release", () => {
        sentinel = null;
        // Dropped by the browser (not by us): try again if still visible.
        if (!stopped) setTimeout(request, 1000);
      });
    } catch {
      sentinel = null;
    }
  };
  const play = () => {
    if (!stopped && !document.hidden) video.play().catch(() => {});
  };
  const onVisibility = () => {
    if (document.hidden) return;
    request();
    play();
  };

  request();
  play();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibility);
    sentinel?.release().catch(() => {});
    sentinel = null;
    video.pause();
    video.remove();
  };
}
