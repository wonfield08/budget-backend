import { BudgetPeriod } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsPositive, IsString } from 'class-validator';

export class CreateBudgetDto {
  @IsString()
  categoryId: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsEnum(BudgetPeriod)
  period: BudgetPeriod;

  @IsDateString()
  startDate: string;
}
