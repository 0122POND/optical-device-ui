"""硬貨の別アプローチ（coin2）の CPU 前処理。

処理本体は preprocessing_cpu_core（硬貨・標準系・硬貨の別アプローチで共通。違いは下の設定だけ）。
app.py と tools はこのモジュールの run_preprocess / save_peak_results を使う。
"""
from typing import Callable, Optional

import preprocessing_cpu_core as core
from preprocessing_cpu_core import (  # noqa: F401  呼び出し側（app.py・tools）向けに再公開
    DEFAULT_DATA_PATH,
    DEFAULT_PEAK_THRESHOLD,
    DEFAULT_RESULT_PATH,
    save_peak_results,
)

# 掃引方向の σ=1、ガウス窓は横方向のみ（縦は均一）
CONFIG = {"sweep_sigma": 1, "gauss_y": False, "step7_message": "ピーク検出を実行中..."}


def run_preprocess(
    data_path: str = DEFAULT_DATA_PATH,
    result_path: str = DEFAULT_RESULT_PATH,
    peak_threshold: int = DEFAULT_PEAK_THRESHOLD,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
) -> dict:
    return core.run_preprocess(data_path, result_path, peak_threshold, progress_callback, **CONFIG)


# CLI実行用
if __name__ == "__main__":
    def print_progress(step: int, total: int, message: str):
        print(f"[{step}/{total}] {message}")

    print("CPU mode")
    result = run_preprocess(progress_callback=print_progress)
    save_peak_results(result["peak_data"], result["image_files"])
    print("完了しました")
