// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPointCloudFromFolder } from "../utils/pointCloud";
import { useWebSocket, type UseWebSocketArgs } from "./useWebSocket";

// 点群の実ロード（fetch + canvas）はテスト対象外なのでモック
vi.mock("../utils/pointCloud", () => ({ buildPointCloudFromFolder: vi.fn() }));
const mockedBuild = vi.mocked(buildPointCloudFromFolder);

/** ブラウザの WebSocket を模した最小実装。生成されたインスタンスを記録し、受信を外から起こせる */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn(() => {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  });

  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** サーバーからのJSONメッセージ受信を模す */
  receive(payload: unknown) {
    this.onmessage?.({ data: typeof payload === "string" ? payload : JSON.stringify(payload) });
  }
}

function makeArgs(overrides: Partial<UseWebSocketArgs> = {}): UseWebSocketArgs {
  return {
    algorithm: "std",
    applyCloudResult: vi.fn(),
    onProgress: vi.fn(),
    onStatus: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

const latest = () => FakeWebSocket.instances.at(-1)!;

describe("useWebSocket", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    // 実装内の console.log / error はノイズなので抑止
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    mockedBuild.mockReset();
  });

  it("マウント時に ws://<hostname>:8000/ws へ接続し、アンマウントで close する", () => {
    const { unmount } = renderHook(() => useWebSocket(makeArgs()));
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(latest().url).toBe(`ws://${window.location.hostname}:8000/ws`);
    unmount();
    expect(latest().close).toHaveBeenCalledTimes(1);
  });

  it("接続が OPEN なら connect() は同じソケットを返し、切断後は新規接続する", () => {
    const { result } = renderHook(() => useWebSocket(makeArgs()));
    const first = latest();
    first.open();
    expect(result.current.connect()).toBe(first);
    expect(FakeWebSocket.instances).toHaveLength(1);

    first.close();
    const second = result.current.connect();
    expect(second).not.toBe(first);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("progress メッセージを onProgress に渡す", () => {
    const args = makeArgs();
    renderHook(() => useWebSocket(args));
    latest().receive({ type: "progress", step: 2, total: 5, message: "処理中", percent: 40 });
    expect(args.onProgress).toHaveBeenCalledWith({
      step: 2,
      total: 5,
      message: "処理中",
      percent: 40,
    });
  });

  it("status は RUNNING / READY だけ onStatus に渡し、COMPLETE は無視する", () => {
    const args = makeArgs();
    renderHook(() => useWebSocket(args));
    latest().receive({ type: "status", value: "RUNNING" });
    latest().receive({ type: "status", value: "COMPLETE" });
    latest().receive({ type: "status", value: "READY" });
    expect(args.onStatus).toHaveBeenCalledTimes(2);
    expect(args.onStatus).toHaveBeenNthCalledWith(1, "RUNNING");
    expect(args.onStatus).toHaveBeenNthCalledWith(2, "READY");
  });

  it("error メッセージは onError('generic') に渡す", () => {
    const args = makeArgs();
    renderHook(() => useWebSocket(args));
    latest().receive({ type: "error", message: "boom" });
    expect(args.onError).toHaveBeenCalledWith("generic", "boom");
  });

  it("JSON でないメッセージや未知の type は例外にならず、コールバックも呼ばない", () => {
    const args = makeArgs();
    renderHook(() => useWebSocket(args));
    expect(() => latest().receive("not json")).not.toThrow();
    latest().receive({ type: "unknown" });
    expect(args.onProgress).not.toHaveBeenCalled();
    expect(args.onStatus).not.toHaveBeenCalled();
    expect(args.onError).not.toHaveBeenCalled();
    expect(args.applyCloudResult).not.toHaveBeenCalled();
  });

  it("ai_inference_complete で mask_result を読み、source='ai' として applyCloudResult する", async () => {
    const cloud = { x: [1], y: [2], z: [3], c: [1] };
    const grid = [[1]];
    mockedBuild.mockResolvedValue({ cloud, grid, width: 1, height: 1, depth: 1 });
    const args = makeArgs();
    renderHook(() => useWebSocket(args));

    await act(async () => {
      latest().receive({ type: "ai_inference_complete", count: 10, device: "cuda" });
    });

    expect(mockedBuild).toHaveBeenCalledTimes(1);
    expect(mockedBuild.mock.calls[0][0]).toMatchObject({
      folderUrl: "/data/mask_result",
      threshold: 128,
      flipZ: false,
    });
    expect(mockedBuild.mock.calls[0][0]).not.toHaveProperty("maxTotalPoints");
    expect(args.applyCloudResult).toHaveBeenCalledWith(cloud, grid, {
      plotType: "scatter3d",
      source: "ai",
      progress: { message: "AI推論完了 (cuda)", percent: 100 },
      clearLoading: "ai",
    });
  });

  it("preprocess_complete は algorithm を source にし、tgv のときだけ maxTotalPoints=250000", async () => {
    const cloud = { x: [], y: [], z: [], c: [] };
    mockedBuild.mockResolvedValue({ cloud, grid: [], width: 0, height: 0, depth: 0 });
    const args = makeArgs({ algorithm: "tgv" });
    renderHook(() => useWebSocket(args));

    await act(async () => {
      latest().receive({ type: "preprocess_complete", count: 3 });
    });

    expect(mockedBuild.mock.calls[0][0]).toMatchObject({
      folderUrl: "/data/result",
      maxTotalPoints: 250_000,
    });
    expect(args.applyCloudResult).toHaveBeenCalledWith(cloud, [], {
      plotType: "scatter3d",
      source: "tgv",
      progress: { message: "完了", percent: 100 },
      clearLoading: "acquire",
    });
  });

  it("点群ロード失敗は種別付きで onError に渡す", async () => {
    mockedBuild.mockRejectedValue(new Error("manifest.json が読めません"));
    const args = makeArgs();
    renderHook(() => useWebSocket(args));

    await act(async () => {
      latest().receive({ type: "preprocess_complete" });
    });
    expect(args.onError).toHaveBeenCalledWith("acquire", "manifest.json が読めません");

    await act(async () => {
      latest().receive({ type: "ai_inference_complete", device: "cpu" });
    });
    expect(args.onError).toHaveBeenCalledWith("ai", "manifest.json が読めません");
    expect(args.applyCloudResult).not.toHaveBeenCalled();
  });

  it("再レンダー後は最新のコールバックが使われる（onmessage は張り直さない）", () => {
    const first = makeArgs();
    const { rerender } = renderHook((a: UseWebSocketArgs) => useWebSocket(a), {
      initialProps: first,
    });
    const second = makeArgs();
    rerender(second);

    latest().receive({ type: "status", value: "RUNNING" });
    expect(first.onStatus).not.toHaveBeenCalled();
    expect(second.onStatus).toHaveBeenCalledWith("RUNNING");
    // 再レンダーで接続は増えない
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
