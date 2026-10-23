import logger from '../config/logger';
import { supabase } from '../config/database';
import { SystemClock } from './clock';
import { ReminderEngine } from './reminder-engine';
import { RenewalExecutor } from './renewal-executor';
import * as services from './index-refs';

// A very small service container used to wire default instances for the app
// and to allow tests to override dependencies.

export type ServiceDeps = Partial<{
  supabase: typeof supabase;
  logger: typeof logger;
  clock: SystemClock;
  // external services - keep generic any so we can pass mocks in tests
  emailService: any;
  pushService: any;
  slackService: any;
  blockchainService: any;
  userPreferenceService: any;
  notificationPreferenceService: any;
  telegramBotService: any;
}>;

export class Container {
  public supabase: any;
  public logger: any;
  public clock: any;
  public emailService: any;
  public pushService: any;
  public slackService: any;
  public blockchainService: any;
  public userPreferenceService: any;
  public notificationPreferenceService: any;
  public telegramBotService: any;

  public reminderEngine: ReminderEngine;
  public renewalExecutor: RenewalExecutor;

  constructor(deps: ServiceDeps = {}) {
    this.supabase = deps.supabase ?? supabase;
    this.logger = deps.logger ?? logger;
    this.clock = deps.clock ?? new SystemClock();
    this.emailService = deps.emailService ?? services.emailService;
    this.pushService = deps.pushService ?? services.pushService;
    this.slackService = deps.slackService ?? services.slackService;
    this.blockchainService = deps.blockchainService ?? services.blockchainService;
    this.userPreferenceService = deps.userPreferenceService ?? services.userPreferenceService;
    this.notificationPreferenceService = deps.notificationPreferenceService ?? services.notificationPreferenceService;
    this.telegramBotService = deps.telegramBotService ?? services.telegramBotService;

    this.reminderEngine = new ReminderEngine({
      supabase: this.supabase,
      logger: this.logger,
      emailService: this.emailService,
      pushService: this.pushService,
      slackService: this.slackService,
      blockchainService: this.blockchainService,
      userPreferenceService: this.userPreferenceService,
      notificationPreferenceService: this.notificationPreferenceService,
      telegramBotService: this.telegramBotService,
      clock: this.clock,
    });

    this.renewalExecutor = new RenewalExecutor({
      supabase: this.supabase,
      logger: this.logger,
      blockchainService: this.blockchainService,
      webhookService: services.webhookService,
      channelStateService: services.channelStateService,
      settlementBatcher: services.settlementBatcher,
      stealthScanner: services.stealthScanner,
      clock: this.clock,
    });
  }
}

export const container = new Container();
