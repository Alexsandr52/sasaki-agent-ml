import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOpportunity, mergeOpportunity } from '../src/lib/opportunity.mjs';
import { assessItem, minimumExperienceYears } from '../src/lib/filter.mjs';
const cfg = { directions: ['ML/AI Engineer'], keywords: [], stopwords: [], grades: ['intern','junior'], formats: [] };
test('source activity does not occupy tracker status', () => {
  assert.deepEqual(normalizeOpportunity({ status: 'active', title: 'ML Engineer' }), { availability: 'active', title: 'ML Engineer' });
  const prior = {source:'x', id:'1', status:'Отклик', letter:'mine', notes:'notes', collectedAt:'yesterday'};
  const next = mergeOpportunity(prior, {source:'y', id:'2', status:'closed', letter:'overwrite', notes:'overwrite', collectedAt:'today'});
  assert.deepEqual(next, {...prior, availability:'closed'});
});
test('spelled-out Russian experience and numeric ranges', () => {
  assert.equal(minimumExperienceYears({requirements:'Опыт в ML от двух лет'}),2);
  assert.equal(minimumExperienceYears({experience:'От 1 до 3 лет'}),1);
  assert.equal(minimumExperienceYears({experience:'1–3 года'}),1);
  assert.equal(minimumExperienceYears({requirements:'Experience of 2.5 years'}),2.5);
});
test('strictest mandatory experience wins over short metadata', () => {
  assert.equal(minimumExperienceYears({experienceMin:0, requirements:'Опыт Python 1 год; опыт ML от 3 лет'}),3);
  assert.equal(minimumExperienceYears({experience:'no_experience', requirements:'Опыт 3 года будет плюсом'}),0);
});
test('ML developer and open internship program are role matches', () => {
  assert.equal(assessItem({title:'ML-разработчик', level:'junior', experienceMin:0},cfg).decision,'suitable');
  assert.equal(assessItem({title:'ML-стажировка в Яндексе',level:'intern',experienceMin:0,opportunityType:'internship_program',availability:'active'},cfg).decision,'suitable');
});
test('MTS junior title and recruiting text have a visible conflict', () => {
  assert.equal(assessItem({title:'Младший Data Scientist', description:'Команда в поиске Middle Data Scientist',experience:'1–3 года'},cfg).decision,'review');
});
test('activity and user tracker remain independent', () => {
  assert.equal(assessItem({title:'Junior ML Engineer',availability:'closed',status:'Отклик'},cfg).decision,'excluded');
});

test('unconfirmed internship programs never become active opportunities', () => {
  assert.equal(assessItem({title:'ML-стажировка',level:'intern',opportunityType:'internship_program',availability:'unknown'},cfg).decision,'excluded');
});

test('explicit no-experience ML role does not need an extra junior title', () => {
  assert.equal(assessItem({title:'ML Engineer',experience:'no_experience'},cfg).decision,'suitable');
});

test('HH coarse experience category excludes experienced roles but surfaces explicit exceptions', () => {
  assert.equal(assessItem({title:'ML Engineer',experienceCategory:'3–6 лет'},cfg).decision,'excluded');
  assert.equal(assessItem({title:'Junior/Middle Data Scientist',experienceCategory:'3–6 лет',requirements:'Опыт от 1 года в ML. Готовы рассмотреть сильных кандидатов с меньшим опытом, но с хорошими pet-проектами.'},cfg).decision,'review');
  assert.equal(assessItem({title:'Junior/Middle Data Scientist'},cfg).decision,'review');
});

test('expert and teamlead are not entry grades', () => {
  for (const level of ['expert','Teamlead']) assert.equal(assessItem({title:'ML Engineer',level},cfg).decision,'excluded');
});
test('optional requirement in another HTML list item does not erase mandatory experience', () => {
  assert.equal(minimumExperienceYears({requirements:'<ul><li>Опыт ML от 3 лет</li><li>Будет плюсом опыт Python</li></ul>'}),3);
});
