import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The button hits this. Creates a record + stages an event in one transaction. */
  @Post()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.createOrder(dto);
  }

  @Get()
  list() {
    return this.orders.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.orders.getWithAudit(id);
  }
}
