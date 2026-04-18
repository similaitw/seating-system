"""
自動編排演算法
"""
from typing import List, Optional, Set, Tuple
from models.student import Student
from models.classroom import Classroom
from models.seating import SeatingArrangement
import random

class AutoArrange:
    """自動編排演算法類別"""

    @staticmethod
    def _ensure_seats_matrix(classroom: Classroom, arrangement: SeatingArrangement) -> None:
        """確保 arrangement 的座位矩陣尺寸與教室一致"""
        if not arrangement.seats:
            arrangement.initialize_empty_seats(classroom.rows, classroom.cols)
            return

        if len(arrangement.seats) != classroom.rows:
            arrangement.initialize_empty_seats(classroom.rows, classroom.cols)
            return

        # 檢查每一列長度
        for row in arrangement.seats:
            if len(row) != classroom.cols:
                arrangement.initialize_empty_seats(classroom.rows, classroom.cols)
                return

    @staticmethod
    def _get_available_positions(
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> List[Tuple[int, int]]:
        """取得可用位置（排除空座位、鎖定座位、已佔用座位）"""
        available_positions: List[Tuple[int, int]] = []
        for row in range(classroom.rows):
            for col in range(classroom.cols):
                if (classroom.is_valid_position(row, col) and
                    not arrangement.is_locked(row, col) and
                    arrangement.get_student_at(row, col) is None):
                    available_positions.append((row, col))
        return available_positions

    @staticmethod
    def _place_fixed_students(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> Set[str]:
        """
        先放置固定座位學生。

        規則：
        - 固定座位必須是有效座位（非空位）
        - 不覆蓋鎖定座位上的其他學生
        - 避免同一學生被放置兩次（例如原本就在鎖定座位）
        """
        placed: Set[str] = set()

        for student in students:
            if not student.fixed_position:
                continue

            fixed_row, fixed_col = student.fixed_position
            if not classroom.is_valid_position(fixed_row, fixed_col):
                continue

            # 若學生已在某座位（通常是鎖定座位），不重複放置
            existing_pos = arrangement.find_student_position(student.id)
            if existing_pos is not None:
                if existing_pos == (fixed_row, fixed_col):
                    placed.add(student.id)
                    continue
                if arrangement.is_locked(existing_pos[0], existing_pos[1]):
                    placed.add(student.id)
                    continue
                arrangement.set_student_at(existing_pos[0], existing_pos[1], None)

            occupant = arrangement.get_student_at(fixed_row, fixed_col)
            if occupant and occupant != student.id:
                # 固定座位被別人佔用：若座位鎖定就跳過，未鎖定也不強制覆蓋
                if arrangement.is_locked(fixed_row, fixed_col):
                    continue
                continue

            arrangement.set_student_at(fixed_row, fixed_col, student.id)
            placed.add(student.id)

        return placed
    
    @staticmethod
    def by_seat_number(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> SeatingArrangement:
        """
        按座號順序排列
        從左到右、從前到後
        """
        AutoArrange._ensure_seats_matrix(classroom, arrangement)
        # 清空未鎖定的座位
        arrangement.clear_all_unlocked()

        # 先放置固定座位
        AutoArrange._place_fixed_students(students, classroom, arrangement)
        
        # 按座號排序
        assigned = set(arrangement.get_assigned_students())
        remaining_students = [s for s in students if s.id not in assigned]
        sorted_students = sorted(remaining_students, key=lambda s: s.seat_number)
        
        # 取得可用位置（排除空座位和鎖定座位）
        available_positions = AutoArrange._get_available_positions(classroom, arrangement)
        
        # 填入學生
        for student, (row, col) in zip(sorted_students, available_positions):
            arrangement.set_student_at(row, col, student.id)
        
        return arrangement
    
    @staticmethod
    def alternating_gender(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> SeatingArrangement:
        """
        男女間隔排列
        避免同性別連坐
        """
        AutoArrange._ensure_seats_matrix(classroom, arrangement)
        arrangement.clear_all_unlocked()
        AutoArrange._place_fixed_students(students, classroom, arrangement)

        assigned = set(arrangement.get_assigned_students())
        remaining_students = [s for s in students if s.id not in assigned]
        
        # 分組
        males = sorted([s for s in remaining_students if s.gender == '男'], key=lambda s: s.seat_number)
        females = sorted([s for s in remaining_students if s.gender == '女'], key=lambda s: s.seat_number)
        
        # 取得可用位置
        available_positions = AutoArrange._get_available_positions(classroom, arrangement)
        
        # 交替填入
        male_idx = 0
        female_idx = 0
        
        for row, col in available_positions:
            # 優先填入人數較多的性別
            if male_idx < len(males) and female_idx < len(females):
                # 交替
                if (row + col) % 2 == 0:
                    arrangement.set_student_at(row, col, males[male_idx].id)
                    male_idx += 1
                else:
                    arrangement.set_student_at(row, col, females[female_idx].id)
                    female_idx += 1
            elif male_idx < len(males):
                arrangement.set_student_at(row, col, males[male_idx].id)
                male_idx += 1
            elif female_idx < len(females):
                arrangement.set_student_at(row, col, females[female_idx].id)
                female_idx += 1
        
        return arrangement
    
    @staticmethod
    def by_height(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> SeatingArrangement:
        """
        按身高排列
        前矮後高
        """
        AutoArrange._ensure_seats_matrix(classroom, arrangement)
        arrangement.clear_all_unlocked()
        AutoArrange._place_fixed_students(students, classroom, arrangement)

        assigned = set(arrangement.get_assigned_students())
        remaining_students = [s for s in students if s.id not in assigned]
        
        # 過濾有身高資料的學生並排序
        students_with_height = [s for s in remaining_students if s.height is not None]
        students_without_height = [s for s in remaining_students if s.height is None]
        
        sorted_students = sorted(students_with_height, key=lambda s: s.height)
        sorted_students.extend(students_without_height)  # 沒有身高資料的放後面
        
        # 取得可用位置（按排序：從前到後、從左到右）
        available_positions = AutoArrange._get_available_positions(classroom, arrangement)
        
        # 填入學生
        for student, (row, col) in zip(sorted_students, available_positions):
            arrangement.set_student_at(row, col, student.id)
        
        return arrangement
    
    @staticmethod
    def by_vision(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> SeatingArrangement:
        """
        按視力排列
        視力較差的坐前面
        """
        AutoArrange._ensure_seats_matrix(classroom, arrangement)
        arrangement.clear_all_unlocked()
        AutoArrange._place_fixed_students(students, classroom, arrangement)

        assigned = set(arrangement.get_assigned_students())
        remaining_students = [s for s in students if s.id not in assigned]
        
        # 按視力排序（視力差的在前）
        sorted_students = sorted(remaining_students, key=lambda s: s.vision_min)
        
        # 取得可用位置
        available_positions = AutoArrange._get_available_positions(classroom, arrangement)
        
        # 填入學生
        for student, (row, col) in zip(sorted_students, available_positions):
            arrangement.set_student_at(row, col, student.id)
        
        return arrangement
    
    @staticmethod
    def random_arrange(
        students: List[Student],
        classroom: Classroom,
        arrangement: SeatingArrangement
    ) -> SeatingArrangement:
        """
        隨機排列
        """
        AutoArrange._ensure_seats_matrix(classroom, arrangement)
        arrangement.clear_all_unlocked()
        AutoArrange._place_fixed_students(students, classroom, arrangement)

        assigned = set(arrangement.get_assigned_students())
        remaining_students = [s for s in students if s.id not in assigned]
        
        # 隨機打亂學生順序
        shuffled_students = remaining_students.copy()
        random.shuffle(shuffled_students)
        
        # 取得可用位置
        available_positions = AutoArrange._get_available_positions(classroom, arrangement)
        
        # 填入學生
        for student, (row, col) in zip(shuffled_students, available_positions):
            arrangement.set_student_at(row, col, student.id)
        
        return arrangement
