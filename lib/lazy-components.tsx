// Lazy load heavy components for better performance
import dynamic from "next/dynamic"

export const AddSubscriptionModal = dynamic(() => import("@/components/modals/add-subscription-modal"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
})

export const EditSubscriptionModal = dynamic(() => import("@/components/modals/edit-subscription-modal"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
})

export const ManageIntegrationModal = dynamic(() => import("@/components/modals/manage-integration-modal"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
})

export const InsightsModal = dynamic(() => import("@/components/modals/insights-modal"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
})

export const OnboardingModal = dynamic(() => import("@/components/modals/onboarding-modal"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading...</div>,
})

export const AnalyticsPage = dynamic(() => import("@/components/pages/analytics"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading analytics...</div>,
})

export const TeamsPage = dynamic(() => import("@/components/pages/teams"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading teams...</div>,
})

export const SettingsPage = dynamic(() => import("@/components/pages/settings"), {
  loading: () => <div className="flex items-center justify-center p-8">Loading settings...</div>,
})
