/**
 * AUTO-GENERATED — do not edit manually.
 * Source: supabase/migrations (see supabase/schema.snapshot.json).
 * Regenerate: npm run generate:db -w shared
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      "account_deletions": {
        Row: {
          cancelled_at: string | null;
          completed_at: string | null;
          id: string | null;
          reason: string | null;
          requested_at: string | null;
          scheduled_deletion_at: string | null;
          status: string | null;
          user_id: string | null;
        };
        Insert: {
          cancelled_at?: string | null;
          completed_at?: string | null;
          id?: string | null;
          reason?: string | null;
          requested_at?: string | null;
          scheduled_deletion_at?: string | null;
          status?: string | null;
          user_id?: string | null;
        };
        Update: {
          cancelled_at?: string | null;
          completed_at?: string | null;
          id?: string | null;
          reason?: string | null;
          requested_at?: string | null;
          scheduled_deletion_at?: string | null;
          status?: string | null;
          user_id?: string | null;
        };
      };
      "agent_wallet_history": {
        Row: {
          address_index: number | null;
          agent_name: string | null;
          drain_tx_hash: string | null;
          id: string | null;
          public_key: string | null;
          reason: string | null;
          recorded_at: string | null;
        };
        Insert: {
          address_index?: number | null;
          agent_name?: string | null;
          drain_tx_hash?: string | null;
          id?: string | null;
          public_key?: string | null;
          reason?: string | null;
          recorded_at?: string | null;
        };
        Update: {
          address_index?: number | null;
          agent_name?: string | null;
          drain_tx_hash?: string | null;
          id?: string | null;
          public_key?: string | null;
          reason?: string | null;
          recorded_at?: string | null;
        };
      };
      "agent_wallet_rotations": {
        Row: {
          agent_name: string | null;
          created_at: string | null;
          current_index: number | null;
          id: string | null;
          last_rotated_at: string | null;
          public_key: string | null;
          rotation_count: number | null;
          updated_at: string | null;
        };
        Insert: {
          agent_name?: string | null;
          created_at?: string | null;
          current_index?: number | null;
          id?: string | null;
          last_rotated_at?: string | null;
          public_key?: string | null;
          rotation_count?: number | null;
          updated_at?: string | null;
        };
        Update: {
          agent_name?: string | null;
          created_at?: string | null;
          current_index?: number | null;
          id?: string | null;
          last_rotated_at?: string | null;
          public_key?: string | null;
          rotation_count?: number | null;
          updated_at?: string | null;
        };
      };
      "app_settings": {
        Row: {
          created_at: string | null;
          enable_registration: boolean | null;
          id: string | null;
          maintenance_mode: boolean | null;
          rate_limit_threshold: number | null;
          updated_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          enable_registration?: boolean | null;
          id?: string | null;
          maintenance_mode?: boolean | null;
          rate_limit_threshold?: number | null;
          updated_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          enable_registration?: boolean | null;
          id?: string | null;
          maintenance_mode?: boolean | null;
          rate_limit_threshold?: number | null;
          updated_at?: string | null;
        };
      };
      "audit_logs": {
        Row: {
          action: string | null;
          created_at: string | null;
          entry_hash: string | null;
          id: string | null;
          ip_address: string | null;
          metadata: Json | null;
          prev_hash: string | null;
          resource_id: string | null;
          resource_type: string | null;
          sequence: number | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          action?: string | null;
          created_at?: string | null;
          entry_hash?: string | null;
          id?: string | null;
          ip_address?: string | null;
          metadata?: Json | null;
          prev_hash?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          sequence?: number | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string | null;
          created_at?: string | null;
          entry_hash?: string | null;
          id?: string | null;
          ip_address?: string | null;
          metadata?: Json | null;
          prev_hash?: string | null;
          resource_id?: string | null;
          resource_type?: string | null;
          sequence?: number | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
      };
      "blockchain_logs": {
        Row: {
          block_number: string | null;
          created_at: string;
          error_message: string | null;
          event_data: string | null;
          event_type: string | null;
          id: string | null;
          status: string | null;
          transaction_hash: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          block_number?: string | null;
          created_at: string;
          error_message?: string | null;
          event_data?: string | null;
          event_type?: string | null;
          id?: string | null;
          status?: string | null;
          transaction_hash?: string | null;
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          block_number?: string | null;
          created_at?: string;
          error_message?: string | null;
          event_data?: string | null;
          event_type?: string | null;
          id?: string | null;
          status?: string | null;
          transaction_hash?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "budget_alert_logs": {
        Row: {
          alert_type: string | null;
          id: string | null;
          month: string | null;
          sent_at: string | null;
          user_id: string | null;
        };
        Insert: {
          alert_type?: string | null;
          id?: string | null;
          month?: string | null;
          sent_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          alert_type?: string | null;
          id?: string | null;
          month?: string | null;
          sent_at?: string | null;
          user_id?: string | null;
        };
      };
      "channel_alert_logs": {
        Row: {
          alert_type: string | null;
          channel_id: string | null;
          id: string | null;
          sent_at: string | null;
          user_id: string | null;
        };
        Insert: {
          alert_type?: string | null;
          channel_id?: string | null;
          id?: string | null;
          sent_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          alert_type?: string | null;
          channel_id?: string | null;
          id?: string | null;
          sent_at?: string | null;
          user_id?: string | null;
        };
      };
      "channel_payments": {
        Row: {
          amount: number;
          channel_id: string | null;
          created_at: string | null;
          id: string | null;
          sequence_number: string | null;
          subscription_id: string | null;
          user_id: string | null;
        };
        Insert: {
          amount: number;
          channel_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          sequence_number?: string | null;
          subscription_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          channel_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          sequence_number?: string | null;
          subscription_id?: string | null;
          user_id?: string | null;
        };
      };
      "channel_states": {
        Row: {
          balance: number;
          channel_id: string;
          confirmed: boolean | null;
          counterparty_signature: string | null;
          created_at: string | null;
          id: string | null;
          nonce: string;
          signature: string | null;
          state_number: string | null;
        };
        Insert: {
          balance: number;
          channel_id: string;
          confirmed?: boolean | null;
          counterparty_signature?: string | null;
          created_at?: string | null;
          id?: string | null;
          nonce: string;
          signature?: string | null;
          state_number?: string | null;
        };
        Update: {
          balance?: number;
          channel_id?: string;
          confirmed?: boolean | null;
          counterparty_signature?: string | null;
          created_at?: string | null;
          id?: string | null;
          nonce?: string;
          signature?: string | null;
          state_number?: string | null;
        };
      };
      "commitment_blinding_factors": {
        Row: {
          blinding_factor: string | null;
          commitment_hash: string | null;
          commitment_index: string | null;
          created_at: string;
          event_data: string | null;
          event_type: string | null;
          id: string | null;
          user_id: string | null;
        };
        Insert: {
          blinding_factor?: string | null;
          commitment_hash?: string | null;
          commitment_index?: string | null;
          created_at: string;
          event_data?: string | null;
          event_type?: string | null;
          id?: string | null;
          user_id?: string | null;
        };
        Update: {
          blinding_factor?: string | null;
          commitment_hash?: string | null;
          commitment_index?: string | null;
          created_at?: string;
          event_data?: string | null;
          event_type?: string | null;
          id?: string | null;
          user_id?: string | null;
        };
      };
      "contract_events": {
        Row: {
          event_data: string | null;
          event_type: string;
          id: string | null;
          ledger: number | null;
          processed_at: string | null;
          sub_id: string | null;
          tx_hash: string;
        };
        Insert: {
          event_data?: string | null;
          event_type: string;
          id?: string | null;
          ledger?: number | null;
          processed_at?: string | null;
          sub_id?: string | null;
          tx_hash: string;
        };
        Update: {
          event_data?: string | null;
          event_type?: string;
          id?: string | null;
          ledger?: number | null;
          processed_at?: string | null;
          sub_id?: string | null;
          tx_hash?: string;
        };
      };
      "deletion_audit_trail": {
        Row: {
          created_at: string | null;
          deletion_id: string | null;
          id: string | null;
          metadata: string | null;
          status: string | null;
          step: string | null;
        };
        Insert: {
          created_at?: string | null;
          deletion_id?: string | null;
          id?: string | null;
          metadata?: string | null;
          status?: string | null;
          step?: string | null;
        };
        Update: {
          created_at?: string | null;
          deletion_id?: string | null;
          id?: string | null;
          metadata?: string | null;
          status?: string | null;
          step?: string | null;
        };
      };
      "demo_rls_table": {
        Row: {
          created_at: string | null;
          demo_data: string | null;
          id: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          demo_data?: string | null;
          id?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          demo_data?: string | null;
          id?: string | null;
          user_id?: string | null;
        };
      };
      "digest_audit_log": {
        Row: {
          digest_type: string | null;
          error_message: string | null;
          id: string | null;
          period_label: string | null;
          sent_at: string | null;
          status: string | null;
          user_id: string | null;
        };
        Insert: {
          digest_type?: string | null;
          error_message?: string | null;
          id?: string | null;
          period_label?: string | null;
          sent_at?: string | null;
          status?: string | null;
          user_id?: string | null;
        };
        Update: {
          digest_type?: string | null;
          error_message?: string | null;
          id?: string | null;
          period_label?: string | null;
          sent_at?: string | null;
          status?: string | null;
          user_id?: string | null;
        };
      };
      "dismissed_suggestions": {
        Row: {
          created_at: string | null;
          dismissed_until: string | null;
          id: string | null;
          subscription_id: string | null;
          suggestion_type: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          dismissed_until?: string | null;
          id?: string | null;
          subscription_id?: string | null;
          suggestion_type?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          dismissed_until?: string | null;
          id?: string | null;
          subscription_id?: string | null;
          suggestion_type?: string | null;
          user_id?: string | null;
        };
      };
      "event_cursor": {
        Row: {
          id: number | null;
          last_ledger: number | null;
          updated_at: string | null;
        };
        Insert: {
          id?: number | null;
          last_ledger?: number | null;
          updated_at?: string | null;
        };
        Update: {
          id?: number | null;
          last_ledger?: number | null;
          updated_at?: string | null;
        };
      };
      "gift_card_ledger": {
        Row: {
          amount: number;
          balance_after: number;
          created_at: string | null;
          currency: string | null;
          description: string | null;
          id: string | null;
          reference_id: string | null;
          subscription_id: string | null;
          type: string | null;
          user_id: string | null;
        };
        Insert: {
          amount: number;
          balance_after: number;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          id?: string | null;
          reference_id?: string | null;
          subscription_id?: string | null;
          type?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          balance_after?: number;
          created_at?: string | null;
          currency?: string | null;
          description?: string | null;
          id?: string | null;
          reference_id?: string | null;
          subscription_id?: string | null;
          type?: string | null;
          user_id?: string | null;
        };
      };
      "global_privacy_flags": {
        Row: {
          enabled: boolean | null;
          flag_name: string | null;
          updated_at: string;
        };
        Insert: {
          enabled?: boolean | null;
          flag_name?: string | null;
          updated_at: string;
        };
        Update: {
          enabled?: boolean | null;
          flag_name?: string | null;
          updated_at?: string;
        };
      };
      "health_metrics_snapshots": {
        Row: {
          alerts_triggered: string | null;
          blockchain_failed_last_hour: number | null;
          contract_errors_last_hour: number | null;
          failed_renewals_last_hour: number | null;
          id: string | null;
          last_agent_activity_at: string | null;
          pending_reminders: number | null;
          processed_reminders_last_24h: number | null;
          recorded_at: string | null;
          successful_deliveries_last_hour: number | null;
        };
        Insert: {
          alerts_triggered?: string | null;
          blockchain_failed_last_hour?: number | null;
          contract_errors_last_hour?: number | null;
          failed_renewals_last_hour?: number | null;
          id?: string | null;
          last_agent_activity_at?: string | null;
          pending_reminders?: number | null;
          processed_reminders_last_24h?: number | null;
          recorded_at?: string | null;
          successful_deliveries_last_hour?: number | null;
        };
        Update: {
          alerts_triggered?: string | null;
          blockchain_failed_last_hour?: number | null;
          contract_errors_last_hour?: number | null;
          failed_renewals_last_hour?: number | null;
          id?: string | null;
          last_agent_activity_at?: string | null;
          pending_reminders?: number | null;
          processed_reminders_last_24h?: number | null;
          recorded_at?: string | null;
          successful_deliveries_last_hour?: number | null;
        };
      };
      "idempotency_keys": {
        Row: {
          created_at: string | null;
          expires_at: string | null;
          id: string | null;
          key: string | null;
          request_hash: string | null;
          response_body: string | null;
          response_status: number | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          expires_at?: string | null;
          id?: string | null;
          key?: string | null;
          request_hash?: string | null;
          response_body?: string | null;
          response_status?: number | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          expires_at?: string | null;
          id?: string | null;
          key?: string | null;
          request_hash?: string | null;
          response_body?: string | null;
          response_status?: number | null;
          user_id?: string | null;
        };
      };
      "invoices": {
        Row: {
          content_type: string | null;
          created_at: string | null;
          file_name: string | null;
          id: string | null;
          payment_id: string | null;
          size_bytes: string | null;
          source: string | null;
          storage_path: string | null;
          subscription_id: string | null;
          user_id: string | null;
        };
        Insert: {
          content_type?: string | null;
          created_at?: string | null;
          file_name?: string | null;
          id?: string | null;
          payment_id?: string | null;
          size_bytes?: string | null;
          source?: string | null;
          storage_path?: string | null;
          subscription_id?: string | null;
          user_id?: string | null;
        };
        Update: {
          content_type?: string | null;
          created_at?: string | null;
          file_name?: string | null;
          id?: string | null;
          payment_id?: string | null;
          size_bytes?: string | null;
          source?: string | null;
          storage_path?: string | null;
          subscription_id?: string | null;
          user_id?: string | null;
        };
      };
      "llm_usage_ledger": {
        Row: {
          cached: boolean | null;
          completion_tokens: number | null;
          cost_usd: number;
          created_at: string | null;
          id: string | null;
          model: string | null;
          prompt_tokens: number | null;
          prompt_version: string | null;
          scan_id: string | null;
          total_tokens: number | null;
          user_id: string | null;
        };
        Insert: {
          cached?: boolean | null;
          completion_tokens?: number | null;
          cost_usd?: number;
          created_at?: string | null;
          id?: string | null;
          model?: string | null;
          prompt_tokens?: number | null;
          prompt_version?: string | null;
          scan_id?: string | null;
          total_tokens?: number | null;
          user_id?: string | null;
        };
        Update: {
          cached?: boolean | null;
          completion_tokens?: number | null;
          cost_usd?: number;
          created_at?: string | null;
          id?: string | null;
          model?: string | null;
          prompt_tokens?: number | null;
          prompt_version?: string | null;
          scan_id?: string | null;
          total_tokens?: number | null;
          user_id?: string | null;
        };
      };
      "notification_deliveries": {
        Row: {
          attempt_count: number | null;
          channel: string | null;
          created_at: string;
          error_message: string | null;
          id: string | null;
          last_attempt_at: string | null;
          max_attempts: number | null;
          metadata: Json | null;
          next_retry_at: string | null;
          reminder_schedule_id: string | null;
          status: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          attempt_count?: number | null;
          channel?: string | null;
          created_at: string;
          error_message?: string | null;
          id?: string | null;
          last_attempt_at?: string | null;
          max_attempts?: number | null;
          metadata?: Json | null;
          next_retry_at?: string | null;
          reminder_schedule_id?: string | null;
          status?: string | null;
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          attempt_count?: number | null;
          channel?: string | null;
          created_at?: string;
          error_message?: string | null;
          id?: string | null;
          last_attempt_at?: string | null;
          max_attempts?: number | null;
          metadata?: Json | null;
          next_retry_at?: string | null;
          reminder_schedule_id?: string | null;
          status?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "payment_channels": {
        Row: {
          balance: number;
          channel_id: string;
          channel_state: Json | null;
          closed_at: string | null;
          counterparty: string | null;
          created_at: string | null;
          deposit_amount: number;
          expiry: string | null;
          id: string | null;
          last_settlement_at: string | null;
          metadata: string | null;
          on_chain_channel_id: string | null;
          opened_at: string | null;
          recipient_id: string;
          state: string | null;
          state_signature: string | null;
          status: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          balance: number;
          channel_id: string;
          channel_state?: Json | null;
          closed_at?: string | null;
          counterparty?: string | null;
          created_at?: string | null;
          deposit_amount: number;
          expiry?: string | null;
          id?: string | null;
          last_settlement_at?: string | null;
          metadata?: string | null;
          on_chain_channel_id?: string | null;
          opened_at?: string | null;
          recipient_id: string;
          state?: string | null;
          state_signature?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          balance?: number;
          channel_id?: string;
          channel_state?: Json | null;
          closed_at?: string | null;
          counterparty?: string | null;
          created_at?: string | null;
          deposit_amount?: number;
          expiry?: string | null;
          id?: string | null;
          last_settlement_at?: string | null;
          metadata?: string | null;
          on_chain_channel_id?: string | null;
          opened_at?: string | null;
          recipient_id?: string;
          state?: string | null;
          state_signature?: string | null;
          status?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "pending_settlements": {
        Row: {
          amount: number;
          batch_id: string | null;
          channel_id: string;
          created_at: string | null;
          error_message: string | null;
          id: string | null;
          max_retries: number | null;
          payload: string | null;
          retry_count: number | null;
          settled_at: string | null;
          settlement_amount: number;
          settlement_fee: number | null;
          settlement_type: string | null;
          status: string | null;
          submitted_at: string | null;
          subscription_id: string | null;
          transaction_hash: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          amount: number;
          batch_id?: string | null;
          channel_id: string;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          max_retries?: number | null;
          payload?: string | null;
          retry_count?: number | null;
          settled_at?: string | null;
          settlement_amount: number;
          settlement_fee?: number | null;
          settlement_type?: string | null;
          status?: string | null;
          submitted_at?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number;
          batch_id?: string | null;
          channel_id?: string;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          max_retries?: number | null;
          payload?: string | null;
          retry_count?: number | null;
          settled_at?: string | null;
          settlement_amount?: number;
          settlement_fee?: number | null;
          settlement_type?: string | null;
          status?: string | null;
          submitted_at?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "privacy_preferences": {
        Row: {
          created_at: string;
          encrypt_on_chain: boolean | null;
          encryption_enabled: boolean | null;
          id: string | null;
          payment_channels: boolean | null;
          payment_channels_enabled: boolean | null;
          preferred_gift_card_provider: string | null;
          privacy_mode: boolean | null;
          private_audit_logs_enabled: boolean | null;
          reminder_jitter: boolean | null;
          stealth_addresses: boolean | null;
          stealth_addresses_enabled: boolean | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at: string;
          encrypt_on_chain?: boolean | null;
          encryption_enabled?: boolean | null;
          id?: string | null;
          payment_channels?: boolean | null;
          payment_channels_enabled?: boolean | null;
          preferred_gift_card_provider?: string | null;
          privacy_mode?: boolean | null;
          private_audit_logs_enabled?: boolean | null;
          reminder_jitter?: boolean | null;
          stealth_addresses?: boolean | null;
          stealth_addresses_enabled?: boolean | null;
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          encrypt_on_chain?: boolean | null;
          encryption_enabled?: boolean | null;
          id?: string | null;
          payment_channels?: boolean | null;
          payment_channels_enabled?: boolean | null;
          preferred_gift_card_provider?: string | null;
          privacy_mode?: boolean | null;
          private_audit_logs_enabled?: boolean | null;
          reminder_jitter?: boolean | null;
          stealth_addresses?: boolean | null;
          stealth_addresses_enabled?: boolean | null;
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "profiles": {
        Row: {
          budget_alert_threshold: number | null;
          channel_auto_top_up: boolean | null;
          channel_auto_top_up_amount: number | null;
          channel_settlement_schedule: string;
          monthly_budget: number | null;
          referral_code: string | null;
          referred_by: string | null;
          stealth_meta_address: string | null;
          stealth_meta_address_created_at: string | null;
          two_fa_enabled_at: string | null;
        };
        Insert: {
          budget_alert_threshold?: number | null;
          channel_auto_top_up?: boolean | null;
          channel_auto_top_up_amount?: number | null;
          channel_settlement_schedule?: string;
          monthly_budget?: number | null;
          referral_code?: string | null;
          referred_by?: string | null;
          stealth_meta_address?: string | null;
          stealth_meta_address_created_at?: string | null;
          two_fa_enabled_at?: string | null;
        };
        Update: {
          budget_alert_threshold?: number | null;
          channel_auto_top_up?: boolean | null;
          channel_auto_top_up_amount?: number | null;
          channel_settlement_schedule?: string;
          monthly_budget?: number | null;
          referral_code?: string | null;
          referred_by?: string | null;
          stealth_meta_address?: string | null;
          stealth_meta_address_created_at?: string | null;
          two_fa_enabled_at?: string | null;
        };
      };
      "push_subscriptions": {
        Row: {
          auth: string | null;
          created_at: string | null;
          endpoint: string | null;
          id: string | null;
          p256dh: string | null;
          updated_at: string | null;
          user_agent: string | null;
          user_id: string | null;
        };
        Insert: {
          auth?: string | null;
          created_at?: string | null;
          endpoint?: string | null;
          id?: string | null;
          p256dh?: string | null;
          updated_at?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
        Update: {
          auth?: string | null;
          created_at?: string | null;
          endpoint?: string | null;
          id?: string | null;
          p256dh?: string | null;
          updated_at?: string | null;
          user_agent?: string | null;
          user_id?: string | null;
        };
      };
      "recovery_codes": {
        Row: {
          code_hash: string | null;
          created_at: string | null;
          id: string | null;
          used_at: string | null;
          user_id: string | null;
        };
        Insert: {
          code_hash?: string | null;
          created_at?: string | null;
          id?: string | null;
          used_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          code_hash?: string | null;
          created_at?: string | null;
          id?: string | null;
          used_at?: string | null;
          user_id?: string | null;
        };
      };
      "referrals": {
        Row: {
          converted_at: string | null;
          created_at: string | null;
          id: string | null;
          referral_code: string | null;
          referred_user_id: string | null;
          referrer_user_id: string | null;
          reward_granted: boolean | null;
          signed_up_at: string | null;
          status: string | null;
        };
        Insert: {
          converted_at?: string | null;
          created_at?: string | null;
          id?: string | null;
          referral_code?: string | null;
          referred_user_id?: string | null;
          referrer_user_id?: string | null;
          reward_granted?: boolean | null;
          signed_up_at?: string | null;
          status?: string | null;
        };
        Update: {
          converted_at?: string | null;
          created_at?: string | null;
          id?: string | null;
          referral_code?: string | null;
          referred_user_id?: string | null;
          referrer_user_id?: string | null;
          reward_granted?: boolean | null;
          signed_up_at?: string | null;
          status?: string | null;
        };
      };
      "reminder_schedules": {
        Row: {
          created_at: string;
          days_before: number | null;
          id: string | null;
          jitter_offset_hours: number | null;
          reminder_date: string | null;
          reminder_type: string | null;
          status: string | null;
          subscription_id: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at: string;
          days_before?: number | null;
          id?: string | null;
          jitter_offset_hours?: number | null;
          reminder_date?: string | null;
          reminder_type?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          days_before?: number | null;
          id?: string | null;
          jitter_offset_hours?: number | null;
          reminder_date?: string | null;
          reminder_type?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "reminder_settings": {
        Row: {
          created_at: string;
          reminder_days_before: number[];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at: string;
          reminder_days_before?: number[];
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          reminder_days_before?: number[];
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "renewal_approvals": {
        Row: {
          approval_id: string | null;
          blockchain_sub_id: string | null;
          created_at: string | null;
          expires_at: number | null;
          expires_at_ts: string | null;
          id: string | null;
          max_spend: string | null;
          rejected: boolean | null;
          rejection_reason: number | null;
          subscription_id: string | null;
          used: boolean | null;
        };
        Insert: {
          approval_id?: string | null;
          blockchain_sub_id?: string | null;
          created_at?: string | null;
          expires_at?: number | null;
          expires_at_ts?: string | null;
          id?: string | null;
          max_spend?: string | null;
          rejected?: boolean | null;
          rejection_reason?: number | null;
          subscription_id?: string | null;
          used?: boolean | null;
        };
        Update: {
          approval_id?: string | null;
          blockchain_sub_id?: string | null;
          created_at?: string | null;
          expires_at?: number | null;
          expires_at_ts?: string | null;
          id?: string | null;
          max_spend?: string | null;
          rejected?: boolean | null;
          rejection_reason?: number | null;
          subscription_id?: string | null;
          used?: boolean | null;
        };
      };
      "renewal_attempts": {
        Row: {
          correlation_id: string | null;
          created_at: string | null;
          cycle_id: number | null;
          id: string | null;
          idempotency_key: string | null;
          lock_holder: string | null;
          result: Json | null;
          status: string | null;
          subscription_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          correlation_id?: string | null;
          created_at?: string | null;
          cycle_id?: number | null;
          id?: string | null;
          idempotency_key?: string | null;
          lock_holder?: string | null;
          result?: Json | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          correlation_id?: string | null;
          created_at?: string | null;
          cycle_id?: number | null;
          id?: string | null;
          idempotency_key?: string | null;
          lock_holder?: string | null;
          result?: Json | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "renewal_dead_letter_queue": {
        Row: {
          amount: number | null;
          approval_id: string | null;
          correlation_id: string | null;
          created_at: string | null;
          cycle_id: number | null;
          dead_letter_at: string | null;
          failure_count: number | null;
          id: string | null;
          idempotency_key: string | null;
          last_error_message: string | null;
          last_failure_reason: string | null;
          subscription_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          amount?: number | null;
          approval_id?: string | null;
          correlation_id?: string | null;
          created_at?: string | null;
          cycle_id?: number | null;
          dead_letter_at?: string | null;
          failure_count?: number | null;
          id?: string | null;
          idempotency_key?: string | null;
          last_error_message?: string | null;
          last_failure_reason?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number | null;
          approval_id?: string | null;
          correlation_id?: string | null;
          created_at?: string | null;
          cycle_id?: number | null;
          dead_letter_at?: string | null;
          failure_count?: number | null;
          id?: string | null;
          idempotency_key?: string | null;
          last_error_message?: string | null;
          last_failure_reason?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "renewal_locks": {
        Row: {
          cycle_id: string | null;
          expires_at: string | null;
          id: string | null;
          lock_holder: string | null;
          locked_at: string | null;
          status: string | null;
          subscription_id: string | null;
        };
        Insert: {
          cycle_id?: string | null;
          expires_at?: string | null;
          id?: string | null;
          lock_holder?: string | null;
          locked_at?: string | null;
          status?: string | null;
          subscription_id?: string | null;
        };
        Update: {
          cycle_id?: string | null;
          expires_at?: string | null;
          id?: string | null;
          lock_holder?: string | null;
          locked_at?: string | null;
          status?: string | null;
          subscription_id?: string | null;
        };
      };
      "renewal_logs": {
        Row: {
          correlation_id: string | null;
          created_at: string | null;
          ephemeral_pubkey: string | null;
          error_message: string | null;
          failure_reason: string | null;
          id: string | null;
          status: string | null;
          stealth_address: string | null;
          subscription_id: string | null;
          transaction_hash: string | null;
          user_id: string | null;
        };
        Insert: {
          correlation_id?: string | null;
          created_at?: string | null;
          ephemeral_pubkey?: string | null;
          error_message?: string | null;
          failure_reason?: string | null;
          id?: string | null;
          status?: string | null;
          stealth_address?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          user_id?: string | null;
        };
        Update: {
          correlation_id?: string | null;
          created_at?: string | null;
          ephemeral_pubkey?: string | null;
          error_message?: string | null;
          failure_reason?: string | null;
          id?: string | null;
          status?: string | null;
          stealth_address?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          user_id?: string | null;
        };
      };
      "stealth_payments": {
        Row: {
          amount: number | null;
          asset: string | null;
          created_at: string | null;
          detected_at: string | null;
          ephemeral_pubkey: string | null;
          id: string | null;
          ledger: number | null;
          recipient_address: string | null;
          timestamp: string | null;
          transaction_hash: string | null;
          user_id: string | null;
        };
        Insert: {
          amount?: number | null;
          asset?: string | null;
          created_at?: string | null;
          detected_at?: string | null;
          ephemeral_pubkey?: string | null;
          id?: string | null;
          ledger?: number | null;
          recipient_address?: string | null;
          timestamp?: string | null;
          transaction_hash?: string | null;
          user_id?: string | null;
        };
        Update: {
          amount?: number | null;
          asset?: string | null;
          created_at?: string | null;
          detected_at?: string | null;
          ephemeral_pubkey?: string | null;
          id?: string | null;
          ledger?: number | null;
          recipient_address?: string | null;
          timestamp?: string | null;
          transaction_hash?: string | null;
          user_id?: string | null;
        };
      };
      "subscription_approvals": {
        Row: {
          approval_type: string | null;
          created_at: string | null;
          expires_at: string | null;
          id: string | null;
          status: string | null;
          subscription_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          approval_type?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          approval_type?: string | null;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "subscription_classifications": {
        Row: {
          category: string | null;
          created_at: string | null;
          id: string | null;
          service_name: string | null;
        };
        Insert: {
          category?: string | null;
          created_at?: string | null;
          id?: string | null;
          service_name?: string | null;
        };
        Update: {
          category?: string | null;
          created_at?: string | null;
          id?: string | null;
          service_name?: string | null;
        };
      };
      "subscription_gift_cards": {
        Row: {
          created_at: string;
          gift_card_hash: string | null;
          id: string | null;
          provider: string | null;
          status: string | null;
          subscription_id: string | null;
          transaction_hash: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          created_at: string;
          gift_card_hash?: string | null;
          id?: string | null;
          provider?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          created_at?: string;
          gift_card_hash?: string | null;
          id?: string | null;
          provider?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          transaction_hash?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "subscription_reencryption_progress": {
        Row: {
          completed_at: string | null;
          created_at: string | null;
          error_message: string | null;
          id: string | null;
          new_wallet_public_key: string | null;
          old_wallet_public_key: string | null;
          started_at: string | null;
          status: string | null;
          subscription_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          new_wallet_public_key?: string | null;
          old_wallet_public_key?: string | null;
          started_at?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          completed_at?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          new_wallet_public_key?: string | null;
          old_wallet_public_key?: string | null;
          started_at?: string | null;
          status?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "subscription_renewal_attempts": {
        Row: {
          attempt_date: string | null;
          attempt_type: string | null;
          correlation_id: string | null;
          created_at: string | null;
          error_message: string | null;
          id: string | null;
          subscription_id: string | null;
          success: boolean | null;
          updated_subscription_record: boolean | null;
        };
        Insert: {
          attempt_date?: string | null;
          attempt_type?: string | null;
          correlation_id?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          subscription_id?: string | null;
          success?: boolean | null;
          updated_subscription_record?: boolean | null;
        };
        Update: {
          attempt_date?: string | null;
          attempt_type?: string | null;
          correlation_id?: string | null;
          created_at?: string | null;
          error_message?: string | null;
          id?: string | null;
          subscription_id?: string | null;
          success?: boolean | null;
          updated_subscription_record?: boolean | null;
        };
      };
      "subscription_risk_scores": {
        Row: {
          created_at: string | null;
          id: string | null;
          last_calculated_at: string | null;
          last_notified_risk_level: string | null;
          risk_factors: string | null;
          risk_level: string | null;
          subscription_id: string | null;
          updated_at: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          last_calculated_at?: string | null;
          last_notified_risk_level?: string | null;
          risk_factors?: string | null;
          risk_level?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          last_calculated_at?: string | null;
          last_notified_risk_level?: string | null;
          risk_factors?: string | null;
          risk_level?: string | null;
          subscription_id?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
        };
      };
      "subscription_share_audit_log": {
        Row: {
          action: string | null;
          actor_user_id: string | null;
          created_at: string | null;
          id: string | null;
          invite_id: string | null;
          metadata: Json | null;
          subscription_id: string | null;
        };
        Insert: {
          action?: string | null;
          actor_user_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          invite_id?: string | null;
          metadata?: Json | null;
          subscription_id?: string | null;
        };
        Update: {
          action?: string | null;
          actor_user_id?: string | null;
          created_at?: string | null;
          id?: string | null;
          invite_id?: string | null;
          metadata?: Json | null;
          subscription_id?: string | null;
        };
      };
      "subscription_share_invites": {
        Row: {
          created_at: string | null;
          created_by: string | null;
          expires_at: string | null;
          id: string | null;
          max_uses: number | null;
          permission_level: string | null;
          revoked_at: string | null;
          subscription_id: string | null;
          token_hash: string | null;
          updated_at: string | null;
          use_count: number | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string | null;
          max_uses?: number | null;
          permission_level?: string | null;
          revoked_at?: string | null;
          subscription_id?: string | null;
          token_hash?: string | null;
          updated_at?: string | null;
          use_count?: number | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string | null;
          id?: string | null;
          max_uses?: number | null;
          permission_level?: string | null;
          revoked_at?: string | null;
          subscription_id?: string | null;
          token_hash?: string | null;
          updated_at?: string | null;
          use_count?: number | null;
        };
      };
      "subscription_tags": {
        Row: {
          created_at: string | null;
          subscription_id: string | null;
          tag_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          subscription_id?: string | null;
          tag_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          subscription_id?: string | null;
          tag_id?: string | null;
        };
      };
      "subscriptions": {
        Row: {
          blockchain_activated_at: string | null;
          blockchain_canceled_at: string | null;
          blockchain_created_at: string | null;
          blockchain_last_renewed_at: string | null;
          blockchain_sub_id: number | null;
          encrypted_category: string | null;
          encrypted_name: string | null;
          encrypted_price: string | null;
          encrypted_renewal_url: string | null;
          executor_address: string | null;
          expired_at: string | null;
          failure_count: number | null;
          is_encrypted: boolean | null;
          last_renewal_attempt_at: string | null;
          last_renewal_cycle_id: string | null;
          pause_reason: string | null;
          paused_at: string | null;
          renewal_cooldown_minutes: number | null;
          resume_at: string | null;
          stealth_address: string | null;
          stealth_index: number | null;
        };
        Insert: {
          blockchain_activated_at?: string | null;
          blockchain_canceled_at?: string | null;
          blockchain_created_at?: string | null;
          blockchain_last_renewed_at?: string | null;
          blockchain_sub_id?: number | null;
          encrypted_category?: string | null;
          encrypted_name?: string | null;
          encrypted_price?: string | null;
          encrypted_renewal_url?: string | null;
          executor_address?: string | null;
          expired_at?: string | null;
          failure_count?: number | null;
          is_encrypted?: boolean | null;
          last_renewal_attempt_at?: string | null;
          last_renewal_cycle_id?: string | null;
          pause_reason?: string | null;
          paused_at?: string | null;
          renewal_cooldown_minutes?: number | null;
          resume_at?: string | null;
          stealth_address?: string | null;
          stealth_index?: number | null;
        };
        Update: {
          blockchain_activated_at?: string | null;
          blockchain_canceled_at?: string | null;
          blockchain_created_at?: string | null;
          blockchain_last_renewed_at?: string | null;
          blockchain_sub_id?: number | null;
          encrypted_category?: string | null;
          encrypted_name?: string | null;
          encrypted_price?: string | null;
          encrypted_renewal_url?: string | null;
          executor_address?: string | null;
          expired_at?: string | null;
          failure_count?: number | null;
          is_encrypted?: boolean | null;
          last_renewal_attempt_at?: string | null;
          last_renewal_cycle_id?: string | null;
          pause_reason?: string | null;
          paused_at?: string | null;
          renewal_cooldown_minutes?: number | null;
          resume_at?: string | null;
          stealth_address?: string | null;
          stealth_index?: number | null;
        };
      };
      "tags": {
        Row: {
          color: string | null;
          created_at: string | null;
          id: string | null;
          name: string | null;
          user_id: string | null;
        };
        Insert: {
          color?: string | null;
          created_at?: string | null;
          id?: string | null;
          name?: string | null;
          user_id?: string | null;
        };
        Update: {
          color?: string | null;
          created_at?: string | null;
          id?: string | null;
          name?: string | null;
          user_id?: string | null;
        };
      };
      "team_invitations": {
        Row: {
          accepted_at: string | null;
          created_at: string | null;
          email: string | null;
          expires_at: string | null;
          id: string | null;
          invited_by: string | null;
          role: string | null;
          team_id: string | null;
          token: string | null;
        };
        Insert: {
          accepted_at?: string | null;
          created_at?: string | null;
          email?: string | null;
          expires_at?: string | null;
          id?: string | null;
          invited_by?: string | null;
          role?: string | null;
          team_id?: string | null;
          token?: string | null;
        };
        Update: {
          accepted_at?: string | null;
          created_at?: string | null;
          email?: string | null;
          expires_at?: string | null;
          id?: string | null;
          invited_by?: string | null;
          role?: string | null;
          team_id?: string | null;
          token?: string | null;
        };
      };
      "teams": {
        Row: {
          require_2fa: boolean | null;
          require_2fa_set_at: string | null;
          slack_webhook_url: string | null;
        };
        Insert: {
          require_2fa?: boolean | null;
          require_2fa_set_at?: string | null;
          slack_webhook_url?: string | null;
        };
        Update: {
          require_2fa?: boolean | null;
          require_2fa_set_at?: string | null;
          slack_webhook_url?: string | null;
        };
      };
      "totp_used_codes": {
        Row: {
          code_hash: string | null;
          expires_at: string | null;
          id: string | null;
          time_window: string | null;
          used_at: string | null;
          user_id: string | null;
        };
        Insert: {
          code_hash?: string | null;
          expires_at?: string | null;
          id?: string | null;
          time_window?: string | null;
          used_at?: string | null;
          user_id?: string | null;
        };
        Update: {
          code_hash?: string | null;
          expires_at?: string | null;
          id?: string | null;
          time_window?: string | null;
          used_at?: string | null;
          user_id?: string | null;
        };
      };
      "user_preferences": {
        Row: {
          automation_flags: string | null;
          calendar_export_reminders: boolean | null;
          calendar_sync_enabled: boolean | null;
          created_at: string;
          digest_day: string | null;
          digest_enabled: boolean | null;
          email_opt_ins: string | null;
          encryption_key: string | null;
          include_year_to_date: boolean | null;
          notification_channels: string[];
          preferred_gift_card_provider: string | null;
          previous_encryption_key: string | null;
          previous_wallet_public_key: string | null;
          privacy_mode_enabled: boolean | null;
          reminder_jitter_level: string | null;
          reminder_timing: number[];
          rotation_completed_at: string | null;
          rotation_in_progress: boolean | null;
          rotation_started_at: string | null;
          subscription_priority_order: string[];
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          automation_flags?: string | null;
          calendar_export_reminders?: boolean | null;
          calendar_sync_enabled?: boolean | null;
          created_at: string;
          digest_day?: string | null;
          digest_enabled?: boolean | null;
          email_opt_ins?: string | null;
          encryption_key?: string | null;
          include_year_to_date?: boolean | null;
          notification_channels?: string[];
          preferred_gift_card_provider?: string | null;
          previous_encryption_key?: string | null;
          previous_wallet_public_key?: string | null;
          privacy_mode_enabled?: boolean | null;
          reminder_jitter_level?: string | null;
          reminder_timing?: number[];
          rotation_completed_at?: string | null;
          rotation_in_progress?: boolean | null;
          rotation_started_at?: string | null;
          subscription_priority_order?: string[];
          updated_at: string;
          user_id?: string | null;
        };
        Update: {
          automation_flags?: string | null;
          calendar_export_reminders?: boolean | null;
          calendar_sync_enabled?: boolean | null;
          created_at?: string;
          digest_day?: string | null;
          digest_enabled?: boolean | null;
          email_opt_ins?: string | null;
          encryption_key?: string | null;
          include_year_to_date?: boolean | null;
          notification_channels?: string[];
          preferred_gift_card_provider?: string | null;
          previous_encryption_key?: string | null;
          previous_wallet_public_key?: string | null;
          privacy_mode_enabled?: boolean | null;
          reminder_jitter_level?: string | null;
          reminder_timing?: number[];
          rotation_completed_at?: string | null;
          rotation_in_progress?: boolean | null;
          rotation_started_at?: string | null;
          subscription_priority_order?: string[];
          updated_at?: string;
          user_id?: string | null;
        };
      };
      "user_telegram_connections": {
        Row: {
          access_token: string | null;
          chat_id: string | null;
          created_at: string | null;
          first_name: string | null;
          id: string | null;
          last_name: string | null;
          updated_at: string | null;
          user_id: string | null;
          username: string | null;
        };
        Insert: {
          access_token?: string | null;
          chat_id?: string | null;
          created_at?: string | null;
          first_name?: string | null;
          id?: string | null;
          last_name?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
        };
        Update: {
          access_token?: string | null;
          chat_id?: string | null;
          created_at?: string | null;
          first_name?: string | null;
          id?: string | null;
          last_name?: string | null;
          updated_at?: string | null;
          user_id?: string | null;
          username?: string | null;
        };
      };
      "wallet_verification_revocations": {
        Row: {
          created_at: string | null;
          id: string | null;
          public_key: string | null;
          reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          public_key?: string | null;
          reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          public_key?: string | null;
          reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          user_id?: string | null;
        };
      };
      "wallet_verifications": {
        Row: {
          created_at: string | null;
          id: string | null;
          message: string | null;
          public_key: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          signature: string | null;
          user_id: string | null;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string | null;
          message?: string | null;
          public_key?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          signature?: string | null;
          user_id?: string | null;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string | null;
          message?: string | null;
          public_key?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          signature?: string | null;
          user_id?: string | null;
          verified_at?: string | null;
        };
      };
      "webhook_events": {
        Row: {
          attempts: number | null;
          created_at: string | null;
          event_data: string | null;
          event_id: string | null;
          event_type: string | null;
          id: string | null;
          last_error: string | null;
          next_attempt_at: string | null;
          processed: boolean | null;
          processed_at: string | null;
          provider: string | null;
          received_at: string | null;
          status: string | null;
          updated_at: string | null;
        };
        Insert: {
          attempts?: number | null;
          created_at?: string | null;
          event_data?: string | null;
          event_id?: string | null;
          event_type?: string | null;
          id?: string | null;
          last_error?: string | null;
          next_attempt_at?: string | null;
          processed?: boolean | null;
          processed_at?: string | null;
          provider?: string | null;
          received_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
        Update: {
          attempts?: number | null;
          created_at?: string | null;
          event_data?: string | null;
          event_id?: string | null;
          event_type?: string | null;
          id?: string | null;
          last_error?: string | null;
          next_attempt_at?: string | null;
          processed?: boolean | null;
          processed_at?: string | null;
          provider?: string | null;
          received_at?: string | null;
          status?: string | null;
          updated_at?: string | null;
        };
      };
      "webhook_rejections": {
        Row: {
          created_at: string | null;
          http_status: number | null;
          id: string | null;
          payload_bytes: number | null;
          provider: string | null;
          reason: string | null;
          source_ip: string | null;
        };
        Insert: {
          created_at?: string | null;
          http_status?: number | null;
          id?: string | null;
          payload_bytes?: number | null;
          provider?: string | null;
          reason?: string | null;
          source_ip?: string | null;
        };
        Update: {
          created_at?: string | null;
          http_status?: number | null;
          id?: string | null;
          payload_bytes?: number | null;
          provider?: string | null;
          reason?: string | null;
          source_ip?: string | null;
        };
      };
      "webhook_replays": {
        Row: {
          created_at: string | null;
          error: string | null;
          id: string | null;
          outcome: string | null;
          reason: string | null;
          requested_by: string | null;
          webhook_event_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          error?: string | null;
          id?: string | null;
          outcome?: string | null;
          reason?: string | null;
          requested_by?: string | null;
          webhook_event_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          error?: string | null;
          id?: string | null;
          outcome?: string | null;
          reason?: string | null;
          requested_by?: string | null;
          webhook_event_id?: string | null;
        };
      };
    };
  };
}

export type PublicTables = Database["public"]["Tables"];

export type AccountDeletionsRow = PublicTables["account_deletions"]["Row"];
export type AccountDeletionsInsert = PublicTables["account_deletions"]["Insert"];
export type AccountDeletionsUpdate = PublicTables["account_deletions"]["Update"];

export type AgentWalletHistoryRow = PublicTables["agent_wallet_history"]["Row"];
export type AgentWalletHistoryInsert = PublicTables["agent_wallet_history"]["Insert"];
export type AgentWalletHistoryUpdate = PublicTables["agent_wallet_history"]["Update"];

export type AgentWalletRotationsRow = PublicTables["agent_wallet_rotations"]["Row"];
export type AgentWalletRotationsInsert = PublicTables["agent_wallet_rotations"]["Insert"];
export type AgentWalletRotationsUpdate = PublicTables["agent_wallet_rotations"]["Update"];

export type AppSettingsRow = PublicTables["app_settings"]["Row"];
export type AppSettingsInsert = PublicTables["app_settings"]["Insert"];
export type AppSettingsUpdate = PublicTables["app_settings"]["Update"];

export type AuditLogsRow = PublicTables["audit_logs"]["Row"];
export type AuditLogsInsert = PublicTables["audit_logs"]["Insert"];
export type AuditLogsUpdate = PublicTables["audit_logs"]["Update"];

export type BlockchainLogsRow = PublicTables["blockchain_logs"]["Row"];
export type BlockchainLogsInsert = PublicTables["blockchain_logs"]["Insert"];
export type BlockchainLogsUpdate = PublicTables["blockchain_logs"]["Update"];

export type BudgetAlertLogsRow = PublicTables["budget_alert_logs"]["Row"];
export type BudgetAlertLogsInsert = PublicTables["budget_alert_logs"]["Insert"];
export type BudgetAlertLogsUpdate = PublicTables["budget_alert_logs"]["Update"];

export type ChannelAlertLogsRow = PublicTables["channel_alert_logs"]["Row"];
export type ChannelAlertLogsInsert = PublicTables["channel_alert_logs"]["Insert"];
export type ChannelAlertLogsUpdate = PublicTables["channel_alert_logs"]["Update"];

export type ChannelPaymentsRow = PublicTables["channel_payments"]["Row"];
export type ChannelPaymentsInsert = PublicTables["channel_payments"]["Insert"];
export type ChannelPaymentsUpdate = PublicTables["channel_payments"]["Update"];

export type ChannelStatesRow = PublicTables["channel_states"]["Row"];
export type ChannelStatesInsert = PublicTables["channel_states"]["Insert"];
export type ChannelStatesUpdate = PublicTables["channel_states"]["Update"];

export type CommitmentBlindingFactorsRow = PublicTables["commitment_blinding_factors"]["Row"];
export type CommitmentBlindingFactorsInsert = PublicTables["commitment_blinding_factors"]["Insert"];
export type CommitmentBlindingFactorsUpdate = PublicTables["commitment_blinding_factors"]["Update"];

export type ContractEventsRow = PublicTables["contract_events"]["Row"];
export type ContractEventsInsert = PublicTables["contract_events"]["Insert"];
export type ContractEventsUpdate = PublicTables["contract_events"]["Update"];

export type DeletionAuditTrailRow = PublicTables["deletion_audit_trail"]["Row"];
export type DeletionAuditTrailInsert = PublicTables["deletion_audit_trail"]["Insert"];
export type DeletionAuditTrailUpdate = PublicTables["deletion_audit_trail"]["Update"];

export type DemoRlsTableRow = PublicTables["demo_rls_table"]["Row"];
export type DemoRlsTableInsert = PublicTables["demo_rls_table"]["Insert"];
export type DemoRlsTableUpdate = PublicTables["demo_rls_table"]["Update"];

export type DigestAuditLogRow = PublicTables["digest_audit_log"]["Row"];
export type DigestAuditLogInsert = PublicTables["digest_audit_log"]["Insert"];
export type DigestAuditLogUpdate = PublicTables["digest_audit_log"]["Update"];

export type DismissedSuggestionsRow = PublicTables["dismissed_suggestions"]["Row"];
export type DismissedSuggestionsInsert = PublicTables["dismissed_suggestions"]["Insert"];
export type DismissedSuggestionsUpdate = PublicTables["dismissed_suggestions"]["Update"];

export type EventCursorRow = PublicTables["event_cursor"]["Row"];
export type EventCursorInsert = PublicTables["event_cursor"]["Insert"];
export type EventCursorUpdate = PublicTables["event_cursor"]["Update"];

export type GiftCardLedgerRow = PublicTables["gift_card_ledger"]["Row"];
export type GiftCardLedgerInsert = PublicTables["gift_card_ledger"]["Insert"];
export type GiftCardLedgerUpdate = PublicTables["gift_card_ledger"]["Update"];

export type GlobalPrivacyFlagsRow = PublicTables["global_privacy_flags"]["Row"];
export type GlobalPrivacyFlagsInsert = PublicTables["global_privacy_flags"]["Insert"];
export type GlobalPrivacyFlagsUpdate = PublicTables["global_privacy_flags"]["Update"];

export type HealthMetricsSnapshotsRow = PublicTables["health_metrics_snapshots"]["Row"];
export type HealthMetricsSnapshotsInsert = PublicTables["health_metrics_snapshots"]["Insert"];
export type HealthMetricsSnapshotsUpdate = PublicTables["health_metrics_snapshots"]["Update"];

export type IdempotencyKeysRow = PublicTables["idempotency_keys"]["Row"];
export type IdempotencyKeysInsert = PublicTables["idempotency_keys"]["Insert"];
export type IdempotencyKeysUpdate = PublicTables["idempotency_keys"]["Update"];

export type InvoicesRow = PublicTables["invoices"]["Row"];
export type InvoicesInsert = PublicTables["invoices"]["Insert"];
export type InvoicesUpdate = PublicTables["invoices"]["Update"];

export type LlmUsageLedgerRow = PublicTables["llm_usage_ledger"]["Row"];
export type LlmUsageLedgerInsert = PublicTables["llm_usage_ledger"]["Insert"];
export type LlmUsageLedgerUpdate = PublicTables["llm_usage_ledger"]["Update"];

export type NotificationDeliveriesRow = PublicTables["notification_deliveries"]["Row"];
export type NotificationDeliveriesInsert = PublicTables["notification_deliveries"]["Insert"];
export type NotificationDeliveriesUpdate = PublicTables["notification_deliveries"]["Update"];

export type PaymentChannelsRow = PublicTables["payment_channels"]["Row"];
export type PaymentChannelsInsert = PublicTables["payment_channels"]["Insert"];
export type PaymentChannelsUpdate = PublicTables["payment_channels"]["Update"];

export type PendingSettlementsRow = PublicTables["pending_settlements"]["Row"];
export type PendingSettlementsInsert = PublicTables["pending_settlements"]["Insert"];
export type PendingSettlementsUpdate = PublicTables["pending_settlements"]["Update"];

export type PrivacyPreferencesRow = PublicTables["privacy_preferences"]["Row"];
export type PrivacyPreferencesInsert = PublicTables["privacy_preferences"]["Insert"];
export type PrivacyPreferencesUpdate = PublicTables["privacy_preferences"]["Update"];

export type ProfilesRow = PublicTables["profiles"]["Row"];
export type ProfilesInsert = PublicTables["profiles"]["Insert"];
export type ProfilesUpdate = PublicTables["profiles"]["Update"];

export type PushSubscriptionsRow = PublicTables["push_subscriptions"]["Row"];
export type PushSubscriptionsInsert = PublicTables["push_subscriptions"]["Insert"];
export type PushSubscriptionsUpdate = PublicTables["push_subscriptions"]["Update"];

export type RecoveryCodesRow = PublicTables["recovery_codes"]["Row"];
export type RecoveryCodesInsert = PublicTables["recovery_codes"]["Insert"];
export type RecoveryCodesUpdate = PublicTables["recovery_codes"]["Update"];

export type ReferralsRow = PublicTables["referrals"]["Row"];
export type ReferralsInsert = PublicTables["referrals"]["Insert"];
export type ReferralsUpdate = PublicTables["referrals"]["Update"];

export type ReminderSchedulesRow = PublicTables["reminder_schedules"]["Row"];
export type ReminderSchedulesInsert = PublicTables["reminder_schedules"]["Insert"];
export type ReminderSchedulesUpdate = PublicTables["reminder_schedules"]["Update"];

export type ReminderSettingsRow = PublicTables["reminder_settings"]["Row"];
export type ReminderSettingsInsert = PublicTables["reminder_settings"]["Insert"];
export type ReminderSettingsUpdate = PublicTables["reminder_settings"]["Update"];

export type RenewalApprovalsRow = PublicTables["renewal_approvals"]["Row"];
export type RenewalApprovalsInsert = PublicTables["renewal_approvals"]["Insert"];
export type RenewalApprovalsUpdate = PublicTables["renewal_approvals"]["Update"];

export type RenewalAttemptsRow = PublicTables["renewal_attempts"]["Row"];
export type RenewalAttemptsInsert = PublicTables["renewal_attempts"]["Insert"];
export type RenewalAttemptsUpdate = PublicTables["renewal_attempts"]["Update"];

export type RenewalDeadLetterQueueRow = PublicTables["renewal_dead_letter_queue"]["Row"];
export type RenewalDeadLetterQueueInsert = PublicTables["renewal_dead_letter_queue"]["Insert"];
export type RenewalDeadLetterQueueUpdate = PublicTables["renewal_dead_letter_queue"]["Update"];

export type RenewalLocksRow = PublicTables["renewal_locks"]["Row"];
export type RenewalLocksInsert = PublicTables["renewal_locks"]["Insert"];
export type RenewalLocksUpdate = PublicTables["renewal_locks"]["Update"];

export type RenewalLogsRow = PublicTables["renewal_logs"]["Row"];
export type RenewalLogsInsert = PublicTables["renewal_logs"]["Insert"];
export type RenewalLogsUpdate = PublicTables["renewal_logs"]["Update"];

export type StealthPaymentsRow = PublicTables["stealth_payments"]["Row"];
export type StealthPaymentsInsert = PublicTables["stealth_payments"]["Insert"];
export type StealthPaymentsUpdate = PublicTables["stealth_payments"]["Update"];

export type SubscriptionApprovalsRow = PublicTables["subscription_approvals"]["Row"];
export type SubscriptionApprovalsInsert = PublicTables["subscription_approvals"]["Insert"];
export type SubscriptionApprovalsUpdate = PublicTables["subscription_approvals"]["Update"];

export type SubscriptionClassificationsRow = PublicTables["subscription_classifications"]["Row"];
export type SubscriptionClassificationsInsert = PublicTables["subscription_classifications"]["Insert"];
export type SubscriptionClassificationsUpdate = PublicTables["subscription_classifications"]["Update"];

export type SubscriptionGiftCardsRow = PublicTables["subscription_gift_cards"]["Row"];
export type SubscriptionGiftCardsInsert = PublicTables["subscription_gift_cards"]["Insert"];
export type SubscriptionGiftCardsUpdate = PublicTables["subscription_gift_cards"]["Update"];

export type SubscriptionReencryptionProgressRow = PublicTables["subscription_reencryption_progress"]["Row"];
export type SubscriptionReencryptionProgressInsert = PublicTables["subscription_reencryption_progress"]["Insert"];
export type SubscriptionReencryptionProgressUpdate = PublicTables["subscription_reencryption_progress"]["Update"];

export type SubscriptionRenewalAttemptsRow = PublicTables["subscription_renewal_attempts"]["Row"];
export type SubscriptionRenewalAttemptsInsert = PublicTables["subscription_renewal_attempts"]["Insert"];
export type SubscriptionRenewalAttemptsUpdate = PublicTables["subscription_renewal_attempts"]["Update"];

export type SubscriptionRiskScoresRow = PublicTables["subscription_risk_scores"]["Row"];
export type SubscriptionRiskScoresInsert = PublicTables["subscription_risk_scores"]["Insert"];
export type SubscriptionRiskScoresUpdate = PublicTables["subscription_risk_scores"]["Update"];

export type SubscriptionShareAuditLogRow = PublicTables["subscription_share_audit_log"]["Row"];
export type SubscriptionShareAuditLogInsert = PublicTables["subscription_share_audit_log"]["Insert"];
export type SubscriptionShareAuditLogUpdate = PublicTables["subscription_share_audit_log"]["Update"];

export type SubscriptionShareInvitesRow = PublicTables["subscription_share_invites"]["Row"];
export type SubscriptionShareInvitesInsert = PublicTables["subscription_share_invites"]["Insert"];
export type SubscriptionShareInvitesUpdate = PublicTables["subscription_share_invites"]["Update"];

export type SubscriptionTagsRow = PublicTables["subscription_tags"]["Row"];
export type SubscriptionTagsInsert = PublicTables["subscription_tags"]["Insert"];
export type SubscriptionTagsUpdate = PublicTables["subscription_tags"]["Update"];

export type SubscriptionsRow = PublicTables["subscriptions"]["Row"];
export type SubscriptionsInsert = PublicTables["subscriptions"]["Insert"];
export type SubscriptionsUpdate = PublicTables["subscriptions"]["Update"];

export type TagsRow = PublicTables["tags"]["Row"];
export type TagsInsert = PublicTables["tags"]["Insert"];
export type TagsUpdate = PublicTables["tags"]["Update"];

export type TeamInvitationsRow = PublicTables["team_invitations"]["Row"];
export type TeamInvitationsInsert = PublicTables["team_invitations"]["Insert"];
export type TeamInvitationsUpdate = PublicTables["team_invitations"]["Update"];

export type TeamsRow = PublicTables["teams"]["Row"];
export type TeamsInsert = PublicTables["teams"]["Insert"];
export type TeamsUpdate = PublicTables["teams"]["Update"];

export type TotpUsedCodesRow = PublicTables["totp_used_codes"]["Row"];
export type TotpUsedCodesInsert = PublicTables["totp_used_codes"]["Insert"];
export type TotpUsedCodesUpdate = PublicTables["totp_used_codes"]["Update"];

export type UserPreferencesRow = PublicTables["user_preferences"]["Row"];
export type UserPreferencesInsert = PublicTables["user_preferences"]["Insert"];
export type UserPreferencesUpdate = PublicTables["user_preferences"]["Update"];

export type UserTelegramConnectionsRow = PublicTables["user_telegram_connections"]["Row"];
export type UserTelegramConnectionsInsert = PublicTables["user_telegram_connections"]["Insert"];
export type UserTelegramConnectionsUpdate = PublicTables["user_telegram_connections"]["Update"];

export type WalletVerificationRevocationsRow = PublicTables["wallet_verification_revocations"]["Row"];
export type WalletVerificationRevocationsInsert = PublicTables["wallet_verification_revocations"]["Insert"];
export type WalletVerificationRevocationsUpdate = PublicTables["wallet_verification_revocations"]["Update"];

export type WalletVerificationsRow = PublicTables["wallet_verifications"]["Row"];
export type WalletVerificationsInsert = PublicTables["wallet_verifications"]["Insert"];
export type WalletVerificationsUpdate = PublicTables["wallet_verifications"]["Update"];

export type WebhookEventsRow = PublicTables["webhook_events"]["Row"];
export type WebhookEventsInsert = PublicTables["webhook_events"]["Insert"];
export type WebhookEventsUpdate = PublicTables["webhook_events"]["Update"];

export type WebhookRejectionsRow = PublicTables["webhook_rejections"]["Row"];
export type WebhookRejectionsInsert = PublicTables["webhook_rejections"]["Insert"];
export type WebhookRejectionsUpdate = PublicTables["webhook_rejections"]["Update"];

export type WebhookReplaysRow = PublicTables["webhook_replays"]["Row"];
export type WebhookReplaysInsert = PublicTables["webhook_replays"]["Insert"];
export type WebhookReplaysUpdate = PublicTables["webhook_replays"]["Update"];

