import type { PostResult } from "../../utils/postprocess";
import { FILLED_COLOR, colors } from "../../utils/constants";
import {
  rowLabelStyle,
  settingRowStyle,
  panelSectionStyle,
  sectionTitleStyle,
  segmentButtonStyle,
  segmentGroupStyle,
} from "../../utils/styles";
import { type PostSettings } from "../../utils/postprocess";

// 操作タブ「後処理」（外れ値除去・走査方向の補間。tools/remove_outliers.py・interpolate_scan.py と同じ処理）
export function PostprocessSection({
  post,
  postResult,
  setPost,
  setShowFilled,
  showFilled,
  zData,
}: {
  post: PostSettings;
  postResult: PostResult | null;
  setPost: React.Dispatch<React.SetStateAction<PostSettings>>;
  setShowFilled: React.Dispatch<React.SetStateAction<boolean>>;
  showFilled: boolean;
  zData: (number | null)[][] | null;
}) {
  return (
    <>
      {zData && zData.length > 0 && (
        <section style={panelSectionStyle}>
          <h3 style={sectionTitleStyle}>後処理</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={settingRowStyle}>
              <span
                style={{ ...rowLabelStyle, whiteSpace: "nowrap" }}
                title="中央値から MAD×1.4826×σ を超えて外れた点を欠損にする（基準は下で選ぶ）"
              >
                外れ値の除去
              </span>
              <div style={{ ...segmentGroupStyle, width: "170px" }}>
                {([null, 3, 4] as const).map((sg) => {
                  const on =
                    sg == null ? !post.removeOutliers : post.removeOutliers && post.sigma === sg;
                  return (
                    <button
                      key={String(sg)}
                      className="tt-hover"
                      style={segmentButtonStyle(on)}
                      onClick={() =>
                        setPost((p) =>
                          sg == null
                            ? { ...p, removeOutliers: false }
                            : { ...p, removeOutliers: true, sigma: sg }
                        )
                      }
                    >
                      {sg == null ? "なし" : `${sg}σ`}
                    </button>
                  );
                })}
              </div>
            </div>
            {post.removeOutliers && (
              <div style={settingRowStyle}>
                <span
                  style={{ ...rowLabelStyle, whiteSpace: "nowrap" }}
                  title={
                    "近傍: 同じ走査行の左右の中央値から突き出た点だけを外す（凹凸・段差は残る）\n" +
                    "全体: 面全体の中央値から外れた点を外す（tools/remove_outliers.py と同じ。帯状の大きな異常も拾うが、起伏の大きい面では本物の凹凸も消える）"
                  }
                >
                  外れ値の基準
                </span>
                <div style={{ ...segmentGroupStyle, width: "170px" }}>
                  {(["local", "global"] as const).map((b) => (
                    <button
                      key={b}
                      className="tt-hover"
                      style={segmentButtonStyle(post.outlierBase === b)}
                      onClick={() => setPost((p) => ({ ...p, outlierBase: b }))}
                    >
                      {b === "local" ? "近傍" : "全体"}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={settingRowStyle}>
              <span
                style={{ ...rowLabelStyle, whiteSpace: "nowrap" }}
                title="走査方向（行の並び）の欠損を、3行以下は線形・4〜8行は局所スプラインで埋める（9行以上は埋めない）"
              >
                走査方向の補間
              </span>
              <div style={{ ...segmentGroupStyle, width: "170px" }}>
                {([false, true] as const).map((on) => (
                  <button
                    key={String(on)}
                    className="tt-hover"
                    style={segmentButtonStyle(post.interpolate === on)}
                    onClick={() => setPost((p) => ({ ...p, interpolate: on }))}
                  >
                    {on ? "あり" : "なし"}
                  </button>
                ))}
              </div>
            </div>
            {post.interpolate && (
              <div style={settingRowStyle}>
                <span style={{ ...rowLabelStyle, whiteSpace: "nowrap" }}>補った画素の印</span>
                <div style={{ ...segmentGroupStyle, width: "170px" }}>
                  {([true, false] as const).map((on) => (
                    <button
                      key={String(on)}
                      className="tt-hover"
                      style={segmentButtonStyle(showFilled === on)}
                      onClick={() => setShowFilled(on)}
                    >
                      {on ? "表示" : "隠す"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {postResult && (
            <div
              style={{
                marginTop: "10px",
                fontSize: "11.5px",
                color: colors.textMuted,
                lineHeight: 1.7,
              }}
            >
              {post.removeOutliers && (
                <div>外れ値 {postResult.removed.toLocaleString()} 点を欠損にしました</div>
              )}
              {post.interpolate && (
                <div>
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      backgroundColor: FILLED_COLOR,
                      marginRight: "6px",
                    }}
                  />
                  {(postResult.filledLinear + postResult.filledSpline).toLocaleString()}{" "}
                  画素を補間（線形 {postResult.filledLinear.toLocaleString()}
                  ・スプライン {postResult.filledSpline.toLocaleString()}、長い欠損{" "}
                  {postResult.skipped.toLocaleString()} 画素は埋めず）
                </div>
              )}
              <div style={{ color: colors.textDim, marginTop: "4px" }}>
                Surface・2D・断面・統計・CSV出力に効きます（点群表示は元のまま）。
                補間値は実測ではないので、精度評価には後処理前のデータを使ってください。
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
