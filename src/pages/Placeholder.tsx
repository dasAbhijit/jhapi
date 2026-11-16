export function Placeholder({ title, milestone }: { title: string; milestone?: string }) {
  return (
    <section className="card">
      <h1>{title}</h1>
      <p className="muted">{milestone ? `Coming in ${milestone}. See docs/DESIGN.md for the build plan.` : 'This page does not exist.'}</p>
    </section>
  )
}
