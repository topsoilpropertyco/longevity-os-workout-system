import OnboardingFlow from '@/components/OnboardingFlow';
import { DEMO_LOCATIONS } from '@/lib/fixtures/demo';

export const metadata = { title: 'Setup · Longevity OS' };

export default function OnboardingPage() {
  // TODO(db): read the athlete's saved locations once Supabase is configured.
  return <OnboardingFlow locations={DEMO_LOCATIONS} />;
}
