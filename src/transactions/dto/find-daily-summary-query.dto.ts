import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export class FindDailySummaryQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(3000)
  year: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;
}
