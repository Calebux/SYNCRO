import { AgentConsole } from '@/components/agents/AgentConsole';

export const metadata = {
  title: 'Agents — SYNCRO',
  description: 'Register an agent and decide what it can spend.',
};

export default function AgentsPage() {
  return <AgentConsole />;
}
