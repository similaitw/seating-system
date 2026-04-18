# 互動式教室排座系統（MVP）

這個 repo 目前包含：

- `models/`：學生、教室、座位表的 Python 資料模型（dataclass）
- `utils/auto_arrange.py`：幾個基礎自動排座演算法（Python）
- `web/`：可直接使用的前端 MVP（拖拉排座＋規則檢查＋自動排座＋存檔匯出）
- `art/`：生成藝術（Constraint Bloom）示範頁
- `DEV_TIPS.md`：本專案用到的開發技巧整理
- `CLAUDE.md`：Claude 接手檔（handoff）

## 快速開始（前端）

最簡單：直接用瀏覽器打開 `web/index.html`（僅瀏覽器引擎；不含 Python API、PDF/Excel 匯出）。

建議：用 `server.py` 跑（同時提供靜態檔案與 Python API）：

```bash
python server.py --port 8000
```

然後打開：
- `http://localhost:8000/web/`

> 若未啟動 `server.py`，UI 會顯示 `API：離線`，並停用 Python 引擎與 PDF/Excel 匯出。

## 依賴安裝（可選）

若要啟用「匯出 PDF / 匯出 Excel」，需要安裝依賴：

```bash
pip install -r requirements.txt
```

## 目前支援功能

- 拖拉學生卡片到座位（也可點選後用「指定到座位」）
- 編輯空位/走道（點座位切換）
- 鎖定座位（自動排座不會動）
- 規則檢查（即時顯示違規並標示座位）
  - 相鄰不可同姓別（上下左右）
  - 固定座位必須符合
  - need_front_seat（前排範圍）
  - need_near_teacher（靠近講桌：前/後/左/右）
  - need_aisle_seat（左右邊界或鄰空位）
  - 避開相鄰（學生配對）
- 自動排座：按座號 / 男女間隔 / 隨機
- 自動排座（更多模式）：按身高（前矮後高）/ 按視力（差的在前）
- 排座引擎切換：瀏覽器 / Python（`server.py` + `utils/auto_arrange.py`）
- 匯出/匯入
  - 下載 JSON（包含 classroom/students/arrangement/rules）
  - 載入 JSON
  - 匯出 CSV
  - 匯出 Excel（需 `openpyxl`）
  - 匯出 PDF（需 `reportlab`；server 會嘗試自動找 Windows 字型以支援中文）
  - 本機暫存（localStorage），可用「清除本機暫存」重置

## 資料格式（對齊 Python 模型）

前端 JSON 盡量使用與 `models/student.py`、`models/classroom.py`、`models/seating.py` 類似的欄位：
- `students[*].seat_number`、`students[*].fixed_position`
- `classroom.rows / cols / teacher_desk_position / empty_seats`
- `arrangement.seats`（二維陣列，值為學生 `id` 或 `null`）
- `arrangement.locked_seats`

## 生成藝術

`art/constraint-bloom.html` 是一個自包含的 p5.js 互動生成藝術頁，可從 `web/` 側邊欄連結開啟。
