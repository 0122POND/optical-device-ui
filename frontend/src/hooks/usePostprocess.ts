import { useMemo, useState } from "react";
import {
  applyPostprocess,
  orientFilled,
  postActive,
  POST_OFF,
  type PostSettings,
} from "../utils/postprocess";
import type { DataSource } from "../utils/units";

// 高さマップの後処理（外れ値除去・走査方向の補間）の設定と結果。
// viewZ は表示・断面・統計・CSV出力に使う高さマップ（後処理が切なら元の zData のまま）
export function usePostprocess(
  zData: (number | null)[][] | null,
  dataSource: DataSource,
  flipX: boolean
) {
  // 新しいデータを開いたとき・履歴を復元したときは呼び出し側で POST_OFF に戻す
  const [post, setPost] = useState<PostSettings>(POST_OFF);
  const [showFilled, setShowFilled] = useState(true);
  const postResult = useMemo(
    () => (zData && zData.length > 0 && postActive(post) ? applyPostprocess(zData, post) : null),
    [zData, post]
  );
  // 表示・断面・統計・CSV出力に使う高さマップ（後処理が切なら元のまま）。履歴には元の zData を残す
  const viewZ = postResult?.grid ?? zData;
  // 補った画素の印（表示の向きに合わせる。印を消しているときは null）
  const filledView = useMemo(
    () => (showFilled ? orientFilled(postResult?.filled ?? null, dataSource, flipX) : null),
    [showFilled, postResult, dataSource, flipX]
  );
  return { post, setPost, showFilled, setShowFilled, postResult, viewZ, filledView };
}
