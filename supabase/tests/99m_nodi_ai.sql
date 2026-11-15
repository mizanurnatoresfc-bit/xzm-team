-- নদী AI: who may use it, the daily limit, on/off, usage log.
begin;
select tests.fixture();
select tests.hr_fixture();

select tests.login(tests.id('noroles'));
select tests.throws($$select public.nodi_gate()$$, 'a person with no role cannot use it', '42501');
select tests.throws($$select public.nodi_settings()$$, 'nor read the settings', '42501');

select tests.login(tests.id('hub_mgr'));
select tests.ok((public.nodi_gate() ->> 'model') = 'claude-sonnet-5-5', 'a hub manager passes the gate; model comes from the settings');
select tests.throws($$select public.nodi_configure(true, 'claude-sonnet-5-5', 10, 1000)$$, 'a hub manager cannot change the settings', '42501');
select tests.throws($$select public.nodi_log(auth.uid(), 'm', 1, 1, true)$$, 'a browser user cannot write the usage log', '42501');

select tests.login(tests.id('admin'));
select tests.throws($$select public.nodi_configure(true, 'gpt-4', 10, 1000)$$, 'only claude models', '22023');
select tests.throws($$select public.nodi_configure(true, 'claude-sonnet-5-5', 0, 1000)$$, 'limit must be positive', '22023');
select public.nodi_configure(true, 'claude-haiku-5-5', 2, 500);
select tests.ok((public.nodi_settings() ->> 'model') = 'claude-haiku-5-5', 'the model is changed');

-- the Edge Function logs with the service key
select tests.logout();
select public.nodi_log(tests.id('hub_mgr'), 'claude-haiku-5-5', 100, 50, true);
select public.nodi_log(tests.id('hub_mgr'), 'claude-haiku-5-5', 0, 0, false, '529');
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.nodi_gate()$$, 'the daily limit stops the third request', 'P0001');
select tests.ok((select count(*) = 2 from public.nodi_usage), 'a person sees only their own usage');
select tests.login(tests.id('admin'));
select tests.ok((select sum(requests) = 2 and sum(input_tokens) = 100 from public.nodi_usage_summary(7)), 'the admin sees the totals');

select public.nodi_configure(false, 'claude-haiku-5-5', 50, 500);
select tests.login(tests.id('hub_mgr'));
select tests.throws($$select public.nodi_gate()$$, 'switched off: nobody can use it', 'P0001');
select 'done';
rollback;
