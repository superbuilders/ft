import type { Provider } from '../../models/types'

/**
 * The one provider a run's Pi is configured with.
 */
export interface AgentProvider {
    /** Configured provider id, also Pi's provider id. */
    id: string
    /** The provider's config. */
    provider: Provider
    /** Where Pi sends requests: ft's local relay for an adapted model, else the provider's resolved URL. */
    baseUrl?: string
}
