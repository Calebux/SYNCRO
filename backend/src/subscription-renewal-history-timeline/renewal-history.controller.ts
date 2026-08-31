import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // adjust import path as needed
import { RenewalHistoryService } from './renewal-history.service';
import {
  GetRenewalHistoryQueryDto,
  RenewalHistoryResponseDto,
} from './renewal-history.dto';
import { RenewalEventType } from './renewal-history.entity';

interface AuthenticatedRequest {
  user: { id: string };
}

@ApiTags('Subscriptions — Renewal History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/subscriptions')
export class RenewalHistoryController {
  constructor(private readonly renewalHistoryService: RenewalHistoryService) {}

  /**
   * GET /api/subscriptions/:id/history
   * Returns a paginated, filterable renewal timeline for a subscription.
   */
  @Get(':id/history')
  @ApiOperation({
    summary: 'Get subscription renewal history',
    description:
      'Returns a paginated timeline of all renewal events (renewals, failures, reminders, cancellations) for a given subscription.',
  })
  @ApiParam({
    name: 'id',
    type: 'string',
    format: 'uuid',
    description: 'Subscription UUID',
  })
  @ApiQuery({
    name: 'eventTypes',
    required: false,
    isArray: true,
    enum: RenewalEventType,
    description: 'Filter by event type(s)',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated renewal history',
    type: RenewalHistoryResponseDto,
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Subscription not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async getHistory(
    @Param('id', ParseUUIDPipe) subscriptionId: string,
    @Query() query: GetRenewalHistoryQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RenewalHistoryResponseDto> {
    return this.renewalHistoryService.getHistory(
      subscriptionId,
      req.user.id,
      query,
    );
  }

  /**
   * GET /api/subscriptions/:id/history/export
   * Streams the full history as a CSV download.
   */
  @Get(':id/history/export')
  @ApiOperation({
    summary: 'Export renewal history as CSV',
    description: 'Returns all renewal events for a subscription as a CSV file download.',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'CSV file download' })
  async exportCsv(
    @Param('id', ParseUUIDPipe) subscriptionId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.renewalHistoryService.exportCsv(
      subscriptionId,
      req.user.id,
    );

    const filename = `renewal-history-${subscriptionId}-${Date.now()}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`,
    );
    res.status(HttpStatus.OK).send(csv);
  }
}
