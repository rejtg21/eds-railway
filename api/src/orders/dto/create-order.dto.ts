import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @MinLength(2)
  customer!: string;

  /** Amount in cents. 1 cent .. 100,000.00 */
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;
}
