# 開發技巧（本專案用到的做法）

這份筆記把本專案從「設計 → MVP → 前後端串接 → 匯出」過程中用到的技巧整理成可重複使用的開發模式，方便後續擴充（規則更多、演算法更強、UI 更完整）。

---

## 1) 先做可用的 MVP：零建置、可直接跑

**技巧：先讓功能可用，再逐步抽象與加強。**

- 前端先做成「純靜態」：`web/index.html` + `web/app.js` + `web/styles.css`，開檔即可用。
- 需要 API（Python 引擎、PDF/Excel）時，再加上輕量 `server.py`，把「靜態檔」與「API」一起提供。
- UI 透過 `/api/health` 做能力探測：API 離線時，自動停用 Python 引擎與匯出功能，避免使用者困惑。

---

## 2) 拖拉互動：用 HTML5 Drag & Drop 做最小可用版

**技巧：拖拉不是唯一入口，要保留「點選＋按鈕」備援。**

- 學生卡片與座位上的學生都可 `draggable=true`，拖曳資料用 `dataTransfer` 放 JSON（如 `{studentId}`）。
- 仍保留「選取學生＋選取座位 → 指定到座位」的按鈕流程，讓手機/觸控或不熟拖拉的人也能操作。
- 模式切換（空位編輯/鎖定座位）用明確的狀態切換按鈕，且互斥（同時間只開一種編輯模式），降低誤操作。

---

## 3) 狀態管理：用快照做 Undo/Redo（不用先引入框架）

**技巧：先做到可靠的回溯，再考慮引入狀態庫。**

- 以 `commit()` 方式包住每個動作：
  - 先把目前狀態 `snapshot()` 推入 `undo` stack
  - 清空 `redo`
  - 執行 mutation
  - `render()` + debounce 存入 `localStorage`
- 快照採用 `structuredClone`（若可用）否則 fallback `JSON.parse(JSON.stringify(...))`。
- `localStorage` 用 debounce（例如 250ms），避免每次拖曳都同步寫入造成卡頓。

---

## 4) 規則檢查：用「集合 + 索引」讓計算直覺又快

**技巧：把查詢成本降到 O(1)。**

- `empty_seats` / `locked_seats` 轉成 `Set`（key 用 `"row,col"`），快速判斷座位是否可用。
- 由 `arrangement.seats` 建立 `posByStudent(Map)`，讓「學生目前在哪」可以 O(1) 查到。
- 違規結果輸出成資料結構（`{message, seat_positions, student_ids}`），渲染層只負責：
  - 顯示列表
  - 在座位格子上套 `violation-seat` class 做視覺標示

> 這種分離能讓你後續新增規則時，只改「規則函式」，不用動 UI。

---

## 5) 自動排座：先處理固定/鎖定，再填剩餘

**技巧：排座的順序決定正確性。**

在前端（瀏覽器引擎）與後端（Python 引擎）都採用同一個策略：

1. 清空所有「未鎖定」且「非空位」的座位
2. 先放固定座位（`fixed_position`）
3. 把鎖定座位上的學生也視為已放置（避免重複放置）
4. 收集剩餘可用座位，再依演算法填入

Python 端（`utils/auto_arrange.py`）額外做了：

- `_ensure_seats_matrix()`：確保 `arrangement.seats` 尺寸與教室一致
- `_place_fixed_students()`：避免固定座位覆蓋鎖定座位的既有人、避免同一學生被放置兩次
- `_get_available_positions()`：集中管理「可用座位」的計算，減少重複程式碼

---

## 6) 前後端串接：同一套資料格式、可切換引擎

**技巧：把「演算法」當成可插拔引擎。**

前端維持一份一致 payload：

- `classroom`：`rows/cols/teacher_desk_position/empty_seats...`
- `students`：`id/seat_number/name/gender/.../fixed_position`
- `arrangement`：`seats`（二維）、`locked_seats`
- `rules`：目前由前端做規則檢查；演算法只負責產生 `arrangement`

前端 UI 提供引擎選擇：

- **瀏覽器**：直接在 `web/app.js` 做排座
- **Python**：呼叫 `POST /api/auto-arrange`，回傳 `arrangement.seats`

API 路徑一律用絕對路徑（例如 `/api/health`）：

- 避免從 `/web/` 子路徑呼叫 `./api/...` 造成路徑錯誤。

---

## 7) 匯出：瀏覽器做 CSV，伺服器做 PDF/XLSX（選配）

**技巧：能在前端完成的就前端完成；需要套件/字型的就交給後端。**

- CSV：前端用字串組合即可（`downloadText(..., 'text/csv')`）
- Excel / PDF：後端處理
  - `POST /api/export/xlsx`（需要 `openpyxl`）
  - `POST /api/export/pdf`（需要 `reportlab`）
  - `GET /api/health` 回報是否支援，前端依此啟用/停用按鈕
- PDF 中文字型：`server.py` 會 best-effort 嘗試註冊 Windows 字型（不保證每台機器都有）

---

## 8) 簡易但安全的靜態檔案服務

**技巧：即使用內建 HTTP server，也要防路徑穿越。**

`server.py` 的靜態檔案服務做了：

- 禁止 `..` 的路徑片段
- `resolve()` 後用 `relative_to()` 驗證檔案必須落在 `web/` 或 `art/` 目錄下

---

## 9) 開發時的快速驗證

**技巧：用最便宜的檢查，先排除語法/連線問題。**

- JavaScript 語法：`node --check web/app.js`
- Python 語法：`python -m py_compile server.py utils/auto_arrange.py`
- API 煙霧測試：
  - `GET http://127.0.0.1:8000/api/health`
  - `POST http://127.0.0.1:8000/api/auto-arrange`

---

## 10) 延伸建議（下一步）

- 規則引擎進階：把規則檢查也下放到 Python（或共享規則定義），避免前後端規則不一致
- 自動排座進階：加入回溯/局部搜尋/禁忌搜尋或遺傳演算法，並讓 UI 顯示「最佳化分數/違規最少」
- 匯出進階：提供座位表樣式模板（班級、日期、老師、註記），並加入圖片/校徽

