import { Button } from '@/components/ui/button'

const benefits = [
  {
    title: 'Ranked for usefulness',
    body: 'Every candidate gets a 1–10 score for synthetic-data relevance and a second 1–10 score for Well7 fit — how useful it is to a team building privacy-first tabular and time-series synthetic data for regulated industries. Only the strongest make the brief.',
  },
  {
    title: 'Read before it is summarised',
    body: 'Where a page can be fetched, its summary is written from the full text, not from the feed snippet.',
  },
  {
    title: 'Numbers you can check',
    body: 'A figure in a summary must appear in the source text. A draft that fails the check gets one repair attempt, then falls back to sentences copied from the source.',
  },
]

const steps = [
  {
    title: 'Collect',
    body: 'Each Saturday the pipeline looks back 7 days across arXiv, Hacker News, GitHub, Reddit, Google News and lab blogs for tabular synthesis, differential privacy, time-series generation and adjacent work.',
  },
  {
    title: 'Rank',
    body: 'A language model scores each candidate for synthetic-data relevance and for Well7 fit. Links from earlier briefs are skipped.',
  },
  {
    title: 'Read',
    body: 'The top picks are fetched and summarised, and the numbers in each summary are checked against the source.',
  },
  {
    title: 'Publish',
    body: 'An editorial read ties the week together. Signed-in readers can then save papers and keep private notes.',
  },
]

const sources = [
  'arXiv',
  'Hacker News',
  'GitHub',
  'Google News',
  'Reddit r/MachineLearning',
  'Reddit r/LocalLLaMA',
  'Hugging Face',
  'Microsoft Research',
  'AWS Machine Learning',
  'Google Research',
  'BAIR Berkeley',
  'Together AI',
]

const TRACKED = [
  'Differential Privacy',
  'Tabular Synthesis',
  'Time-Series',
  'Federated Synthesis',
  'Privacy Evaluation',
  'CTGAN / TVAE',
  'SDV · OpenDP · SACRO-ML',
  'PDPL · GDPR · EU AI Act',
]

const feedPoints = [
  'Filter the week by key word, section or search',
  'Save papers to Read later or mark them Important',
  'Keep a private note on any paper',
  'Browse earlier weeks from the sidebar',
]

export function LandingInfo() {
  return (
    <>
    <section className="border-t border-border bg-white/55">
      <div className="mx-auto max-w-7xl space-y-24 px-5 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <p className="text-sm font-semibold text-primary">The brief</p>
            <h2 className="mt-3 text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em]">
              A short brief, not a feed of noise.
            </h2>
            <p className="mt-5 max-w-md leading-7 text-muted-foreground">
              Synthetic data attracts a lot of hype. Each week the brief keeps the tabular and time-series methods, formal
              privacy guarantees, and evaluation results that still hold up when you read them closely.
            </p>
          </div>
          <div className="grid gap-10 sm:grid-cols-3">
            {benefits.map((benefit) => (
              <div key={benefit.title} className="border-t border-border pt-6">
                <h3 className="font-semibold text-ink">{benefit.title}</h3>
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{benefit.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-primary">Process</p>
          <h2 className="mt-3 text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em]">
            How a brief is made.
          </h2>
          <div className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step) => (
              <div key={step.title} className="border-t border-border pt-6">
                <h3 className="font-display text-2xl font-medium text-ink">{step.title}</h3>
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <p className="text-sm font-semibold text-primary">Sources</p>
            <h2 className="mt-3 text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em]">
              Where the links come from.
            </h2>
            <p className="mt-5 max-w-md leading-7 text-muted-foreground">
              arXiv, Hacker News, GitHub and Google News are searched for synthetic data directly. Reddit and the lab
              blogs only count when the title or summary mentions tabular synthesis, differential privacy,
              federated synthesis or a close term.
            </p>
          </div>
          <ul className="flex flex-wrap content-start gap-2">
            {sources.map((source) => (
              <li key={source} className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm text-ink/80" translate="no">
                {source}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>

    <section className="border-t border-border bg-white/55">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="text-sm font-semibold text-primary">Tracked for Well7</p>
        <h2 className="mt-3 text-balance font-display text-4xl font-medium leading-tight tracking-[-0.03em]">
          What we track.
        </h2>
        <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
          The methods, guarantees and regulations behind privacy-first tabular and time-series synthetic data for regulated industries.
        </p>
        <ul className="mt-8 flex flex-wrap content-start gap-2">
          {TRACKED.map((term) => (
            <li key={term} className="rounded-full border border-border bg-white px-3.5 py-1.5 text-sm text-ink/80" translate="no">
              {term}
            </li>
          ))}
        </ul>
      </div>
    </section>
    </>
  )
}

interface SignInTeaserProps {
  onSignIn: () => void
  onSignUp: () => void
}

export function SignInTeaser({ onSignIn, onSignUp }: SignInTeaserProps) {
  return (
    <section className="mx-auto max-w-7xl px-5 pb-4 sm:px-8">
      <div className="grid gap-8 rounded-[24px] border border-border bg-white p-7 shadow-[0_20px_60px_-42px_rgba(16,42,67,0.4)] sm:p-9 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <h2 className="text-balance font-display text-3xl font-medium tracking-[-0.025em]">Sign in to open your feed.</h2>
          <ul className="mt-5 grid gap-2 text-[15px] leading-7 text-muted-foreground sm:grid-cols-2">
            {feedPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" variant="ink" onClick={onSignIn}>
            Sign in
          </Button>
          <Button size="lg" variant="outline" onClick={onSignUp}>
            Create an account
          </Button>
        </div>
      </div>
    </section>
  )
}
