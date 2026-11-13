import json
import unittest
from unittest.mock import patch
import ai_recommender as recommender

class PrerequisiteTests(unittest.TestCase):
    def suggestions(self, label, direction, **kwargs):
        return recommender.relationship_suggestions(label, kwargs.get('meta', {}), set(kwargs.get('exclude', [])), direction, topk=100)

    def test_mixed_numbers_have_different_prerequisites_and_successors(self):
        before = self.suggestions('Mixed numbers', 'builds_on')
        after = self.suggestions('Mixed numbers', 'leads_to')
        self.assertTrue(before)
        self.assertIn('Mixed-number multiplication', {s['label'] for s in after})
        self.assertIn('Mixed-number division', {s['label'] for s in after})
        self.assertFalse({s['label'] for s in before} & {s['label'] for s in after})
        self.assertTrue(all(s['target'] == 'Mixed numbers' for s in before))
        self.assertTrue(all(s['source'] == 'Mixed numbers' for s in after))

    def test_no_keyword_fallback_for_unknown_or_terminal_topic(self):
        self.assertEqual([], self.suggestions('Unlisted mixed fraction idea', 'builds_on'))
        self.assertEqual([], self.suggestions('Mixed-number division', 'leads_to'))

    def test_unit_rate_not_dependent_on_previous_ratio_word_problem(self):
        prerequisites = {s['label'] for s in self.suggestions('Unit rate definition', 'builds_on')}
        self.assertIn('Ratio', prerequisites)
        self.assertNotIn('Rate', prerequisites)

    def test_authored_reason_same_in_both_directions(self):
        forward = next(s for s in self.suggestions('Mixed numbers', 'leads_to') if s['label'] == 'Mixed-number multiplication')
        backward = next(s for s in self.suggestions('Mixed-number multiplication', 'builds_on') if s['label'] == 'Mixed numbers')
        self.assertEqual(forward['reason'], backward['reason'])
        self.assertIn('improper fractions', backward['reason'])

    def test_exclusions_and_legacy_custom_label_alias(self):
        suggestions = self.suggestions('Fractions', 'leads_to', exclude=['Mixed numbers'])
        self.assertNotIn('Mixed numbers', {s['label'] for s in suggestions})
        self.assertIn('Fraction addition', {s['label'] for s in suggestions})

    def test_graph_endpoints_exist_and_have_no_cycles(self):
        all_topics = {(g, u, t) for g, units in recommender.curriculum.items() for u, topics in units.items() for t in topics}
        adjacency = {}
        for edge in recommender.prerequisite_graph['edges']:
            source, target = [tuple(edge[k][p] for p in ('grade','unit','label')) for k in ('source','target')]
            self.assertIn(source, all_topics)
            self.assertIn(target, all_topics)
            self.assertTrue(edge['reason'].strip())
            adjacency.setdefault(source, []).append(target)
        def walk(node, stack, done):
            self.assertNotIn(node, stack)
            if node in done: return
            stack.add(node)
            for nxt in adjacency.get(node, []): walk(nxt, stack, done)
            stack.remove(node); done.add(node)
        done=set()
        for source in adjacency: walk(source, set(), done)

    def test_catalog_deduplicated_within_units_and_concepts_keep_one_identity(self):
        for units in recommender.curriculum.values():
            for topics in units.values():
                self.assertEqual(len(topics),len(set(topics)))
        self.assertIn('Equivalent ratios',recommender.curriculum['7th Grade Math']['Ratios & Proportional Relationships'])
        self.assertIn('Equivalent ratios',recommender.curriculum['6th Grade Math']['Ratios & Proportional Relationships'])
        self.assertEqual('math:equivalent-ratios',recommender.concept_lookup['Equivalent ratios']['conceptId'])

    def test_dependency_requests_cannot_be_overridden_by_llm(self):
        with patch.object(recommender, '_call_llm_provider', side_effect=AssertionError('must not call provider')):
            self.assertIsNone(recommender.llm_relationship_suggestions('Mixed numbers', None, None, set(), 'builds_on'))

    def test_api_direction_and_exhaustion(self):
        client=recommender.app.test_client()
        response=client.post('/recommend',json={'nodes':[], 'selected_node':{'label':'Mixed numbers'},'question':'builds_on'})
        self.assertEqual(200,response.status_code)
        self.assertTrue(all(s['target']=='Mixed numbers' for s in response.json['suggestions']))
        response=client.post('/recommend',json={'nodes':[], 'selected_node':{'label':'Unknown topic'},'question':'builds_on'})
        self.assertEqual([],response.json['suggestions'])

if __name__ == '__main__': unittest.main()
