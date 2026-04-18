"""
教室配置模型
"""
from dataclasses import dataclass, field
from typing import List, Tuple, Optional, Dict

@dataclass
class Classroom:
    """教室配置類別"""
    
    name: str
    rows: int  # 排數（前後）
    cols: int  # 列數（左右）
    
    # 講桌設定
    teacher_desk_position: str = "front"  # front/back/left/right
    special_seats: List[Tuple[int, int]] = field(default_factory=list)  # 講桌旁特殊座位
    
    # 空座位（走道等）
    empty_seats: List[Tuple[int, int]] = field(default_factory=list)
    
    # 座位朝向
    orientation: str = "front"  # 座位面向
    
    def __post_init__(self):
        """驗證資料"""
        if self.rows <= 0 or self.cols <= 0:
            raise ValueError("排數和列數必須大於 0")
        
        if self.teacher_desk_position not in ["front", "back", "left", "right"]:
            raise ValueError("講桌位置必須是 front/back/left/right")
        
        # 驗證特殊座位和空座位在範圍內
        for row, col in self.special_seats + self.empty_seats:
            if not (0 <= row < self.rows and 0 <= col < self.cols):
                raise ValueError(f"座位 ({row}, {col}) 超出範圍")
    
    @property
    def total_seats(self) -> int:
        """總座位數"""
        return self.rows * self.cols - len(self.empty_seats)
    
    def is_empty_seat(self, row: int, col: int) -> bool:
        """檢查是否為空座位"""
        return (row, col) in self.empty_seats
    
    def is_special_seat(self, row: int, col: int) -> bool:
        """檢查是否為講桌旁特殊座位"""
        return (row, col) in self.special_seats
    
    def is_valid_position(self, row: int, col: int) -> bool:
        """檢查位置是否有效（在範圍內且非空座位）"""
        if not (0 <= row < self.rows and 0 <= col < self.cols):
            return False
        return not self.is_empty_seat(row, col)
    
    def get_available_positions(self) -> List[Tuple[int, int]]:
        """取得所有可用座位位置"""
        positions = []
        for row in range(self.rows):
            for col in range(self.cols):
                if self.is_valid_position(row, col):
                    positions.append((row, col))
        return positions
    
    def to_dict(self) -> Dict:
        """轉換為字典"""
        return {
            "name": self.name,
            "rows": self.rows,
            "cols": self.cols,
            "teacher_desk_position": self.teacher_desk_position,
            "special_seats": self.special_seats,
            "empty_seats": self.empty_seats,
            "orientation": self.orientation
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'Classroom':
        """從字典建立"""
        return cls(**data)
