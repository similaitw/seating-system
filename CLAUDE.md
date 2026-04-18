# Claude 接手檔（Project Handoff）

你正在接手一個「互動式教室排座系統」的 MVP。此 repo 目前以 **零建置可用的前端（純 HTML/JS/CSS）** 為主，並提供 **Python `server.py`** 做為本機 API（自動排座引擎與 PDF/Excel 匯出）。

## TL;DR（先跑起來）

1) 啟動 server（推薦）
```bash
python server.py --port 8000
```
打開 `http://localhost:8000/web/`

2) 可選安裝依賴（啟用 PDF/Excel 匯出）
```bash
pip install -r requirements.txt
```

> 若只用瀏覽器直接開 `web/index.html` 也能用，但會顯示 `API：離線`，Python 引擎與 PDF/Excel 會停用。

---

## 專案現況（已完成）

- 前端 MVP（`web/`）
  - 拖拉學生卡片到座位（也支援點選＋按鈕指定）
  - 編輯空位/走道（點座位切換）
  - 鎖定座位（自動排座不會動）
  - Undo/Redo（快照法）
  - 即時規則檢查＋違規清單＋座位標示（上下左右相鄰）
  - 自動排座（瀏覽器引擎）：按座號 / 男女間隔 / 隨機 / 按身高 / 按視力
  - 下載/載入 JSON、匯出 CSV、localStorage 暫存

- Python API（`server.py`）
  - `GET /api/health`：回報 API 是否在線、是否支援 PDF/XLSX 匯出
  - `POST /api/auto-arrange`：呼叫 `utils/auto_arrange.py`
  - `POST /api/export/pdf`（需 `reportlab`）
  - `POST /api/export/xlsx`（需 `openpyxl`）

- Python 自動排座修正（`utils/auto_arrange.py`）
  - 先放固定座位（`fixed_position`），尊重鎖定座位
  - 避免固定座位造成重複放置/覆蓋鎖定座位
  - 抽出 `_ensure_seats_matrix` / `_get_available_positions` / `_place_fixed_students`

---

## Repo 結構導覽（你最常會改的）

- `web/index.html`：UI（sidebar controls + grid）
- `web/app.js`：主要邏輯（狀態、拖拉、規則檢查、自動排座、匯入匯出、API 互動）
- `web/styles.css`：樣式

- `server.py`：本機 server（靜態檔 + API + export）
- `utils/auto_arrange.py`：Python 排座演算法
- `models/student.py` / `models/classroom.py` / `models/seating.py`：dataclass 模型

- `README.md`：使用說明
- `DEV_TIPS.md`：本專案做法整理（MVP/拖拉/Undo/規則/引擎切換/匯出等）
- `PLAN`：早期設計草案（偏願景/模組）

---

## 重要資料格式（前後端共用）

前端下載的 JSON 大致長這樣（核心欄位）：

```json
{
  "version": 1,
  "classroom": {
    "name": "示範教室",
    "rows": 6,
    "cols": 6,
    "teacher_desk_position": "front",
    "empty_seats": [[2,2]],
    "special_seats": [],
    "orientation": "front"
  },
  "students": [
    {
      "id": "S01",
      "seat_number": 1,
      "name": "學生01",
      "gender": "男",
      "height": 160,
      "vision_left": 1.0,
      "vision_right": 1.0,
      "need_front_seat": false,
      "need_aisle_seat": false,
      "need_near_teacher": false,
      "fixed_position": [0,0],
      "notes": ""
    }
  ],
  "arrangement": {
    "id": "arr_xxx",
    "name": "Seating Arrangement",
    "classroom_id": "classroom_default",
    "created_at": "ISO8601",
    "seats": [["S01", null], [null, null]],
    "locked_seats": [[0,0]]
  },
  "rules": {
    "alternating_gender": true,
    "enforce_fixed": true,
    "check_front": true,
    "front_rows": 2,
    "check_near_teacher": false,
    "near_band": 2,
    "check_aisle": false,
    "avoid_pairs": [["S05","S06"]]
  }
}
```

注意：
- `row/col` 在資料內是 **0-based**；UI 顯示是 **1-based**
- `empty_seats` / `locked_seats` 為 `[row, col]` 陣列
- `arrangement.seats` 是二維陣列，內容為學生 `id` 或 `null`

---

## 前端設計要點（避免踩雷）

- `web/app.js` 的核心模式是 `commit(mutator)`：
  - 先做 `snapshot()` 推入 undo stack
  - 清空 redo stack
  - 執行 mutation
  - `render()` + debounce 寫入 localStorage
- 規則檢查與 UI 分離：`evaluateViolations()` 回傳純資料，`renderGrid()`/`renderViolations()` 只負責呈現。
- API 路徑使用 **絕對路徑**（例如 `/api/health`），避免從 `/web/` 子路徑相對呼叫出錯。
- 空位/鎖定模式是互斥的（避免同一個點擊同時被解釋成不同操作）。

---

## Python server 設計要點

- 靜態檔案服務有做路徑穿越防護（禁止 `..`，並用 `resolve()+relative_to()` 檢查必須落在 `web/` 或 `art/` 下）。
- `/api/health` 會回報是否支援匯出（依據是否成功 import `reportlab/openpyxl`）。
- PDF 中文字型：`server.py` 會 best-effort 嘗試註冊 Windows 字型（不保證每台機器都有），必要時可改成專案內建字型檔。

---

## 快速驗證（不寫測試也能先擋掉大問題）

- JS 語法檢查：`node --check web/app.js`
- Python 語法檢查：`python -m py_compile server.py utils/auto_arrange.py`
- API 煙霧測試：
  - `GET http://127.0.0.1:8000/api/health`
  - `POST http://127.0.0.1:8000/api/auto-arrange`

---

## 已知限制 / 建議下一步

已知限制：
- 規則檢查目前只在前端做；Python 排座演算法不會保證滿足所有規則（尤其是 `avoid_pairs`）。
- 目前沒有「最佳化」排座（例如回溯/局部搜尋），只有幾個基礎策略。
- PDF/Excel 匯出需要依賴；未安裝時按鈕會自動 disabled。

建議下一步（按價值排序）：
- [ ] 把規則檢查/評分下放到 Python（或至少共享規則定義），避免前後端規則不一致
- [ ] 新增進階自動排座：回溯/模擬退火/禁忌搜尋/遺傳演算法，並回傳「違規最少」解
- [ ] 增加匯入 Excel/Google Sheet 的流程（或提供範例模板）
- [ ] 增加列印版面（A4/座位圖）與學校抬頭/班級資訊

---

## 生成藝術（非核心）

`art/constraint-bloom.html` 是自包含 p5.js 作品，並在 UI footer 有連結可開啟。它是「規則→力場」的視覺隱喻，和排座邏輯無硬耦合。

