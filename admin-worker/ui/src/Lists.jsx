// Списки записей: работы по категориям, отзывы, типы метрик, позиции статистики и контактов.
import { api, describeError } from './api.js';
import { CONTACT_LABEL } from './labels.js';
import { Badge, Button, Empty, Loading, Notice, go, useLoad } from './ui.jsx';

const Page = ({ title, actions, intro, children }) => (
  <>
    <div className="page-head"><h1>{title}</h1>{actions && <div className="page-actions">{actions}</div>}</div>
    {intro && <p className="intro">{intro}</p>}
    {children}
  </>
);
const State = ({ data, error }) => (error ? <Notice tone="error">{describeError(error)}</Notice> : !data ? <Loading /> : null);
const Published = ({ on }) => <Badge tone={on ? 'ok' : 'mute'}>{on ? 'опубликовано' : 'скрыто'}</Badge>;

export function WorksPage() {
  const { data, error } = useLoad(async () => {
    const [categories, works] = await Promise.all([api.get('/api/categories'), api.get('/api/works')]);
    return { categories: categories.items, works: works.items };
  }, []);
  return (
    <Page title="Работы" intro="Категории — вкладки секции «Работы»; внутри — карточки работ. Категория без опубликованных работ на сайте не показывается."
      actions={<Button kind="primary" icon="plus" onClick={() => go('#/categories/new')}>Новая категория</Button>}>
      <State data={data} error={error} />
      {data && data.categories.length === 0 && <Empty>Категорий пока нет. Создайте первую — затем добавьте в неё работы.</Empty>}
      {data && data.categories.map((category) => {
        const works = data.works.filter((w) => w.category === category.slug);
        return (
          <section className="group" key={category.slug} aria-labelledby={`cat-${category.slug}`}>
            <div className="group-head">
              <h2 id={`cat-${category.slug}`}><a href={`#/categories/${category.slug}`}>{category.title_ru}</a></h2>
              <span className="meta">{category.title_en} · порядок {category.order} · {category.aspect}</span>
              <Published on={category.published} />
              <Button icon="plus" onClick={() => go(`#/works/new?category=${category.slug}`)}>Работа</Button>
            </div>
            {works.length === 0 ? <Empty>В категории нет работ.</Empty> : (
              <ul className="rows">
                {works.map((work) => (
                  <li key={work.slug}>
                    <a className="row" href={`#/works/${work.slug}`}>
                      <img className="row-thumb" src={work.thumbnail} alt="" loading="lazy" />
                      <span className="row-main"><strong>{work.title_ru}</strong><span className="meta">{work.client} · {work.format} · {work.duration}</span></span>
                      <span className="row-side"><span className="meta">порядок {work.order}</span>{work.featured && <Badge tone="info">крупная</Badge>}<Published on={work.published} /></span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </Page>
  );
}

export function TestimonialsPage() {
  const { data, error } = useLoad(() => api.get('/api/testimonials'), []);
  return (
    <Page title="Отзывы" actions={<Button kind="primary" icon="plus" onClick={() => go('#/testimonials/new')}>Новый отзыв</Button>}>
      <State data={data} error={error} />
      {data && data.items.length === 0 && <Empty>Отзывов пока нет.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="rows">
          {data.items.map((t) => (
            <li key={t.slug}>
              <a className="row" href={`#/testimonials/${t.slug}`}>
                {t.logo ? <img className="row-thumb row-thumb--square" src={t.logo} alt="" loading="lazy" /> : <span className="row-thumb row-thumb--square" aria-hidden="true" />}
                <span className="row-main"><strong>{t.channel_name}</strong><span className="meta">{t.channel_topic_ru} · {t.top_metric_value} {t.top_metric_label_ru}</span></span>
                <span className="row-side"><span className="meta">порядок {t.order}</span><Published on={t.published} /></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function MetricTypesPage() {
  const { data, error } = useLoad(() => api.get('/api/metric-types'), []);
  return (
    <Page title="Типы метрик" intro="Подписи нижних метрик в карточке отзыва. Тип, который используется в отзыве, удалить нельзя."
      actions={<Button kind="primary" icon="plus" onClick={() => go('#/metric-types/new')}>Новый тип</Button>}>
      <State data={data} error={error} />
      {data && data.items.length === 0 && <Empty>Типов метрик пока нет.</Empty>}
      {data && data.items.length > 0 && (
        <ul className="rows">
          {data.items.map((m) => (
            <li key={m.slug}>
              <a className="row" href={`#/metric-types/${m.slug}`}>
                <span className="row-main"><strong>{m.label_ru}</strong><span className="meta">{m.label_en} · <code>{m.slug}</code></span></span>
                <span className="row-side"><span className="meta">порядок {m.order}</span></span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

export function PositionsPage({ resource }) {
  const { data, error } = useLoad(() => api.get(`/api/${resource}`), [resource]);
  const stats = resource === 'stats';
  return (
    <Page title={stats ? 'Статистика' : 'Контакты'}
      intro={stats ? 'Четыре показателя под первым экраном. Число позиций задано вёрсткой — их можно только править.'
        : 'Четыре карточки в секции контактов. Изменения попадают на сайт после публикации.'}>
      <State data={data} error={error} />
      {data && (
        <ol className="rows rows--numbered">
          {data.items.map((item, i) => (
            <li key={i}>
              <a className="row" href={`#/${resource}/${i + 1}`}>
                <span className="row-index" aria-hidden="true">{i + 1}</span>
                <span className="row-main">
                  <strong>{stats ? `${item.value} — ${item.label_ru}` : `${CONTACT_LABEL[item.kind]}: ${item.value}`}</strong>
                  <span className="meta">{stats ? `${item.value_en} — ${item.label_en}` : `${item.label_ru} · ${item.label_en}`}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}
