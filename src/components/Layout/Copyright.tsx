export default function Copyright({ className }: { className?: string }) {
  return (
    <a
      href="https://globalspaceweb.co.zw"
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'app-copyright'}
    >
      Developed &amp; Powered By Global Space Web.
    </a>
  )
}
