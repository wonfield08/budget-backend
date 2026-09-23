import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateFixedExpenseDto {
  @IsString()
  accountId: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsInt()
  @IsPositive()
  amount: number;

  // 매달 며칠에 발생하는지. 31처럼 짧은 달에는 없는 날짜는 그 달의 말일로
  // 클램프해서 처리한다 (예산 기능의 setDayClamped와 동일한 방식).
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth: number;

  @IsOptional()
  @IsString()
  memo?: string;
}
