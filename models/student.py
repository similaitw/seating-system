"""
學生資料模型
"""
from dataclasses import dataclass, field
from typing import Optional, Dict, Tuple

@dataclass
class Student:
    """學生資料類別"""
    
    id: str
    seat_number: int
    name: str
    gender: str  # "男" 或 "女"
    height: Optional[int] = None  # 身高（公分）
    vision_left: float = 1.0  # 左眼視力
    vision_right: float = 1.0  # 右眼視力
    
    # 特殊需求
    need_front_seat: bool = False  # 需坐前排
    need_aisle_seat: bool = False  # 需坐走道旁
    need_near_teacher: bool = False  # 需靠近講桌
    fixed_position: Optional[Tuple[int, int]] = None  # 固定座位 (row, col)
    
    notes: str = ""  # 備註
    
    def __post_init__(self):
        """驗證資料"""
        if self.gender not in ["男", "女"]:
            raise ValueError(f"性別必須是 '男' 或 '女'，收到：{self.gender}")
        
        if self.height is not None and self.height <= 0:
            raise ValueError(f"身高必須大於 0，收到：{self.height}")
        
        if not (0 <= self.vision_left <= 2.0):
            raise ValueError(f"視力必須在 0-2.0 之間，收到：{self.vision_left}")
        
        if not (0 <= self.vision_right <= 2.0):
            raise ValueError(f"視力必須在 0-2.0 之間，收到：{self.vision_right}")
    
    @property
    def vision_avg(self) -> float:
        """平均視力"""
        return (self.vision_left + self.vision_right) / 2
    
    @property
    def vision_min(self) -> float:
        """較差的視力"""
        return min(self.vision_left, self.vision_right)
    
    def to_dict(self) -> Dict:
        """轉換為字典"""
        return {
            "id": self.id,
            "seat_number": self.seat_number,
            "name": self.name,
            "gender": self.gender,
            "height": self.height,
            "vision_left": self.vision_left,
            "vision_right": self.vision_right,
            "need_front_seat": self.need_front_seat,
            "need_aisle_seat": self.need_aisle_seat,
            "need_near_teacher": self.need_near_teacher,
            "fixed_position": self.fixed_position,
            "notes": self.notes
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'Student':
        """從字典建立"""
        return cls(**data)
    
    def __str__(self) -> str:
        return f"{self.seat_number:02d} {self.name} ({self.gender})"
