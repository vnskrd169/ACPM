import type { AgentId, AiEventType, RoutePlan, RoutingContext } from './contracts.js';
import { routePlanSchema } from './schemas.js';

function withPmLast(agents: AgentId[]): AgentId[] {
  return [...new Set(agents.filter(agent => agent !== 'pm')), 'pm'];
}

/** Pure, deterministic routing. No database, provider, clock, or network use. */
export function routeAiEvent(
  eventType: AiEventType,
  context: Readonly<RoutingContext> = {}
): RoutePlan {
  let agents: AgentId[];

  switch (eventType) {
    case 'material_delivery_overdue':
      agents = ['materials', 'planning'];
      break;
    case 'material_stock_low':
      agents = context.linkedWorkExists ? ['materials', 'planning'] : ['materials'];
      break;
    case 'task_overdue':
      agents = context.materialOrProcurementRelevant
        ? ['planning', 'materials']
        : ['planning'];
      break;
    case 'site_issue_created':
      agents = context.materialOrProcurementRelevant
        ? ['planning', 'materials']
        : ['planning'];
      break;
    default: {
      const unreachable: never = eventType;
      throw new Error(`Unsupported AI event type: ${String(unreachable)}`);
    }
  }

  return routePlanSchema.parse({ eventType, agents: withPmLast(agents) });
}
