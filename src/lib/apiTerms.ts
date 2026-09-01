/**
 * Draft Developer API terms shown at registration time. This is a
 * reasonable placeholder for a private, invite-only B2B integration
 * program — not reviewed by counsel or the directors yet. Bump
 * API_TERMS_VERSION whenever the wording changes materially so existing
 * developers' recorded acceptance stays tied to the version they actually
 * agreed to.
 */
export const API_TERMS_VERSION = '2026-08-draft-1'

export const API_TERMS_TEXT = `
TARIQIFY IMS: DEVELOPER API TERMS OF USE (DRAFT)

1. SCOPE
This API is private and issued by invitation only. Access is granted solely to the named company/app for the purpose of originating insurance policy sales and related servicing through Tariqify IMS on behalf of the insurer(s) named on each policy.

2. ROLE AND STANDING
A Developer integrating via this API acts as an agent of the platform for every policy, client, and payment it creates through its API key, carrying the same duties, expectations, and accountability as an on-the-ground agent, and remunerated on the same commission basis (rate to be confirmed by the directors and communicated separately; not disclosed within the API interface itself).

3. AUTHORIZED USE
- The API key must only be used by the registered Developer for its own integration.
- API keys must never be shared, embedded in client-side/public code, or committed to source control.
- Each request is scoped server-side to the Developer's own clients and policies; a Developer can never read or modify another Developer's or another agent's records.

4. DATA HANDLING
- Client personal information (national ID, date of birth, contact details) obtained via the API may only be used to complete the insurance transaction it was collected for.
- Developers must not retain client data longer than necessary to fulfil that transaction, and must handle it in line with applicable data protection law.

5. SECURITY
- All traffic must use HTTPS.
- Rate limits are enforced per key; sustained abuse may result in automatic throttling or suspension.
- Suspected key compromise must be reported immediately so the key can be revoked and reissued.

6. SUSPENSION
The platform may suspend a Developer's access at any time, without prior notice, where there is reasonable suspicion of misuse, fraud, data mishandling, or a breach of these terms. Suspension is reversible once the concern is resolved.

7. TERMINATION
The platform may terminate a Developer's access permanently for serious or repeated breaches of these terms. Termination revokes all active API keys immediately and is not reversible; a terminated Developer must be re-registered from scratch, at the platform's discretion, to regain access.

8. NO WARRANTY
The API is provided "as is" during this private/early phase. Endpoints, scopes, and rate limits may change; material changes will be communicated to registered Developers where reasonably practicable.

9. ACCEPTANCE
Registering a Developer account and accepting these terms confirms the above is understood and will be complied with. This document is a working draft and will be superseded by a formal Memorandum of Understanding once finalized by the directors.
`.trim()
