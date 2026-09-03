/**
 * The `paynow` npm package ships no TypeScript types of its own.
 *
 * `npm run build` never catches that locally -- tsconfig.json's
 * `"include": ["src"]` only ever type-checks the browser app, never
 * `api/`. Vercel's own function build type-checks `api/` independently and
 * more strictly, and fails outright ("Could not find a declaration file
 * for module 'paynow'") without this.
 *
 * Shaped from the installed package's actual runtime surface
 * (node_modules/paynow/dist/paynow.js) rather than guessed, and covers only
 * what this codebase calls: the constructor, resultUrl/returnUrl,
 * createPayment, Payment.add, send, pollTransaction and parseStatusUpdate.
 */
declare module 'paynow' {
  export interface PaynowPayment {
    authEmail?: string
    add(name: string, price: number): void
  }

  export interface InitResponse {
    success: boolean
    error?: string
    redirectUrl?: string
    pollUrl?: string
    instructions?: string
  }

  export interface StatusResponse {
    status?: string
    amount?: string | number
    reference?: string
    paynowReference?: string
    pollUrl?: string
    error?: string
  }

  export class Paynow {
    constructor(integrationId?: string, integrationKey?: string, resultUrl?: string, returnUrl?: string)
    resultUrl: string
    returnUrl: string
    createPayment(reference: string, authEmail?: string): PaynowPayment
    send(payment: PaynowPayment): Promise<InitResponse>
    sendMobile(payment: PaynowPayment, phone: string, method: string): Promise<InitResponse>
    pollTransaction(pollUrl: string): Promise<StatusResponse>
    parseStatusUpdate(response: string): StatusResponse
  }
}
