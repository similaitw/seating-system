"""
座位編排模型
"""
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from datetime import datetime
import json

@dataclass
class SeatingArrangement:
    """座位編排類別"""
    
    id: str
    name: str
    classroom_id: str
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    # 座位配置：二維陣列，每個元素是學生 ID 或 None
    seats: List[List[Optional[str]]] = field(default_factory=list)
    
    # 鎖定的座位（不參與自動編排）
    locked_seats: List[Tuple[int, int]] = field(default_factory=list)
    
    def __post_init__(self):
        """初始化"""
        if not self.seats:
            # 如果沒有提供座位配置，建立空的
            self.seats = []
    
    def initialize_empty_seats(self, rows: int, cols: int):
        """初始化空座位表"""
        self.seats = [[None for _ in range(cols)] for _ in range(rows)]
    
    def get_student_at(self, row: int, col: int) -> Optional[str]:
        """取得指定位置的學生 ID"""
        if 0 <= row < len(self.seats) and 0 <= col < len(self.seats[0]):
            return self.seats[row][col]
        return None
    
    def set_student_at(self, row: int, col: int, student_id: Optional[str]):
        """設定指定位置的學生"""
        if 0 <= row < len(self.seats) and 0 <= col < len(self.seats[0]):
            self.seats[row][col] = student_id
    
    def is_locked(self, row: int, col: int) -> bool:
        """檢查座位是否被鎖定"""
        return (row, col) in self.locked_seats
    
    def lock_seat(self, row: int, col: int):
        """鎖定座位"""
        if (row, col) not in self.locked_seats:
            self.locked_seats.append((row, col))
    
    def unlock_seat(self, row: int, col: int):
        """解鎖座位"""
        if (row, col) in self.locked_seats:
            self.locked_seats.remove((row, col))
    
    def swap_seats(self, pos1: Tuple[int, int], pos2: Tuple[int, int]):
        """交換兩個座位"""
        row1, col1 = pos1
        row2, col2 = pos2
        
        student1 = self.get_student_at(row1, col1)
        student2 = self.get_student_at(row2, col2)
        
        self.set_student_at(row1, col1, student2)
        self.set_student_at(row2, col2, student1)
    
    def clear_seat(self, row: int, col: int):
        """清空座位"""
        if not self.is_locked(row, col):
            self.set_student_at(row, col, None)
    
    def clear_all_unlocked(self):
        """清空所有未鎖定的座位"""
        for row in range(len(self.seats)):
            for col in range(len(self.seats[0])):
                if not self.is_locked(row, col):
                    self.seats[row][col] = None
    
    def get_assigned_students(self) -> List[str]:
        """取得所有已安排座位的學生 ID"""
        students = []
        for row in self.seats:
            for student_id in row:
                if student_id:
                    students.append(student_id)
        return students
    
    def find_student_position(self, student_id: str) -> Optional[Tuple[int, int]]:
        """尋找學生的座位位置"""
        for row_idx, row in enumerate(self.seats):
            for col_idx, sid in enumerate(row):
                if sid == student_id:
                    return (row_idx, col_idx)
        return None
    
    def to_dict(self) -> Dict:
        """轉換為字典"""
        return {
            "id": self.id,
            "name": self.name,
            "classroom_id": self.classroom_id,
            "created_at": self.created_at,
            "seats": self.seats,
            "locked_seats": self.locked_seats
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'SeatingArrangement':
        """從字典建立"""
        return cls(**data)
    
    def save_to_file(self, filepath: str):
        """儲存到檔案"""
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
    
    @classmethod
    def load_from_file(cls, filepath: str) -> 'SeatingArrangement':
        """從檔案載入"""
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return cls.from_dict(data)
