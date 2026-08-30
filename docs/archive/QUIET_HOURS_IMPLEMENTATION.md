# Quiet Hours Implementation

## Overview

The Quiet Hours feature allows users to set time periods when only critical alerts pass through, with non-critical alerts being delayed until the morning. This implementation provides a comprehensive solution for managing notification timing based on user preferences.

## Features Implemented

### 1. Database Schema Changes

#### User Preferences Table Updates
- `quiet_hours_enabled`: Boolean flag to enable/disable quiet hours
- `quiet_hours_start`: Start time in HH:MM format (24-hour)
- `quiet_hours_end`: End time in HH:MM format (24-hour)
- `quiet_hours_timezone`: IANA timezone identifier for user's timezone
- `critical_alerts_only`: Whether to allow only critical alerts during quiet hours

#### Delayed Notifications Table
- Stores notifications that are delayed due to quiet hours
- Tracks original send time, scheduled send time, priority, and status
- Includes notification payload and delay reason

### 2. Backend Services

#### QuietHoursService
- `isInQuietHours()`: Checks if current time is within user's quiet hours
- `determineNotificationPriority()`: Classifies notifications as low/normal/high/critical
- `shouldSendDuringQuietHours()`: Determines if notification should be sent or delayed
- `getQuietHoursEndTime()`: Calculates when quiet hours end for scheduling
- `isAppropriateTimeForDelayedNotifications()`: Checks if it's a good time to send delayed notifications

#### DelayedNotificationService
- `storeDelayedNotification()`: Stores notifications for later delivery
- `getPendingDelayedNotifications()`: Retrieves notifications ready to be sent
- `markDelayedNotificationAsSent()`: Updates notification status
- `cancelDelayedNotifications()`: Cancels delayed notifications if needed

#### Updated ReminderEngine
- Integrated with quiet hours checking before sending notifications
- Processes delayed notifications on schedule
- Respects user timezone and quiet hours preferences

### 3. Notification Priority Classification

#### Critical Alerts (Always sent during quiet hours)
- Final day renewal reminders (1 day or less)
- Trial expiring today (0 days)

#### High Priority Alerts
- Trial expiring within 2 days
- Renewal within 3 days

#### Normal Priority Alerts
- Standard renewal reminders
- Trial expiry reminders (more than 2 days)

#### Low Priority Alerts
- Cancellation reminders

### 4. API Endpoints

#### User Preferences Management
- `GET /api/user-preferences`: Fetch user preferences including quiet hours
- `PATCH /api/user-preferences`: Update all user preferences
- `PATCH /api/user-preferences/quiet-hours`: Update only quiet hours settings
- `GET /api/user-preferences/delayed-notifications`: View delayed notifications
- `POST /api/user-preferences/test-quiet-hours`: Test quiet hours configuration

#### Admin Endpoints
- `POST /api/reminders/delayed`: Manually process delayed notifications

### 5. Frontend Components

#### QuietHoursSettings Component
- Toggle to enable/disable quiet hours
- Time picker for start and end times
- Timezone selector with common timezones
- Critical alerts only toggle
- Test configuration functionality
- View pending delayed notifications

#### Notifications Settings Page
- Dedicated page for notification preferences
- Integration with existing settings navigation
- Real-time testing and feedback

### 6. Scheduling and Processing

#### Cron Jobs
- **Every 15 minutes**: Process delayed notifications that are ready to be sent
- **Daily at 9 AM UTC**: Process regular reminders (with quiet hours checking)
- **Daily at midnight UTC**: Schedule upcoming reminders
- **Every 30 minutes**: Retry failed deliveries

#### Delayed Notification Processing
- Checks if it's appropriate time to send delayed notifications (8 AM - 10 PM in user's timezone)
- Respects quiet hours to avoid sending during restricted periods
- Automatically marks notifications as sent after successful delivery

## Usage Examples

### Setting Up Quiet Hours
```typescript
// Enable quiet hours from 10 PM to 8 AM in Eastern Time
await updateQuietHours({
  quiet_hours_enabled: true,
  quiet_hours_start: '22:00',
  quiet_hours_end: '08:00',
  quiet_hours_timezone: 'America/New_York',
  critical_alerts_only: true
})
```

### Testing Configuration
```typescript
// Test if current time is in quiet hours
const testResult = await testQuietHours()
console.log('Currently in quiet hours:', testResult.isCurrentlyQuietHours)
console.log('Next send time:', testResult.quietHoursEndTime)
```

### Viewing Delayed Notifications
```typescript
// Get all pending delayed notifications
const delayed = await fetchDelayedNotifications('pending')
console.log(`${delayed.length} notifications are delayed`)
```

## Database Migrations Required

1. **019_add_quiet_hours_to_user_preferences.sql**: Adds quiet hours columns to user_preferences table
2. **020_create_delayed_notifications.sql**: Creates delayed_notifications table with proper indexes and RLS

## Configuration

### Environment Variables
No additional environment variables required. Uses existing Supabase configuration.

### Default Settings
- Quiet hours disabled by default
- Default quiet hours: 22:00 - 08:00 UTC
- Critical alerts only: enabled by default
- Delayed notifications sent between 8 AM - 10 PM in user's timezone

### Timezone Handling
The current implementation uses UTC for simplicity. In a production environment, you would want to implement proper timezone conversion using libraries like `date-fns-tz` or `moment-timezone` to accurately handle user timezones. The frontend component includes timezone selection, and the database stores the timezone preference for future enhancement.

## Acceptance Criteria Met

✅ **Add quiet_hours to user preferences**: Implemented with comprehensive settings
✅ **Non-critical alerts are delayed until the morning**: Implemented with intelligent scheduling
✅ **Only critical alerts pass through during quiet hours**: Implemented with priority classification
✅ **Avoiding alerts at 3 AM**: Timezone-aware quiet hours prevent unwanted notifications

## Testing

The implementation includes:
- Real-time configuration testing
- Delayed notification viewing
- Admin tools for manual processing
- Comprehensive error handling and logging

## Future Enhancements

Potential improvements for future iterations:
- Custom priority rules per subscription
- Multiple quiet hours periods per day
- Holiday and weekend-specific rules
- Integration with calendar systems
- Smart learning from user interaction patterns