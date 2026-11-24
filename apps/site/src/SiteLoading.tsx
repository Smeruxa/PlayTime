export default function SiteLoading() {
    return (
        <div className="site-loading" data-site-loading="route" role="status" aria-live="polite">
            <div className="site-loading__content">
                <span className="site-loading__line" aria-hidden="true" />
                <p className="site-loading__brand">PlayTime</p>
                <p className="site-loading__text">Загружаем сайт…</p>
            </div>
        </div>
    )
}
