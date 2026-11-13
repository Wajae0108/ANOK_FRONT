// 음성 회의 잡음 대응 설정이 LiveKit 기본값과 병합된 뒤에도 유지되는지 확인한다(라이브러리 업그레이드로 병합 방식이 바뀌는 경우 대비).
import { describe, expect, it } from "vitest";
import { Room } from "livekit-client";
import { VOICE_ROOM_OPTIONS } from "../src/meetings/VoiceRoom";

describe("VoiceRoom 오디오 설정", () => {
  const room = new Room(VOICE_ROOM_OPTIONS);
  const publish = room.options.publishDefaults!; // Room 생성자가 항상 기본값과 병합해 채운다

  it("DTX를 끈다(무음 구간 comfort noise 방지) — 1단계", () => {
    expect(publish.dtx).toBe(false);
  });

  it("RED는 아직 유지한다 — 2단계에서 비교", () => {
    expect(publish.red).toBe(true);
  });

  it("캡처 처리는 기존 값 그대로다(voiceIsolation만 끔)", () => {
    expect(room.options.audioCaptureDefaults).toMatchObject({
      echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: false,
    });
  });

  it("publishDefaults를 일부만 넘겨도 나머지 기본값은 유지된다", () => {
    expect(publish.audioPreset).toBeDefined();
  });
});
