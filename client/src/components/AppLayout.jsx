import { useEffect, useRef, useState } from 'react';
import { NavLink as RouterNavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Lenis from 'lenis';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Burger,
  Divider,
  Group,
  Menu,
  NavLink,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBuildingFactory2,
  IconCash,
  IconChartHistogram,
  IconChefHat,
  IconClipboardList,
  IconCookie,
  IconFileInvoice,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPackages,
  IconReceiptTax,
  IconSettings,
  IconShoppingCart,
  IconSun,
  IconUserCog,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useAuth } from '../context/AuthContext';

const NAV = [
  { section: 'Overview' },
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard, permission: 'dashboard.view', end: true },
  { href: '/operational_flow.html', label: 'Interactive Flow Guide', icon: IconCookie, permission: 'dashboard.view', external: true },

  { section: 'Manufacturing' },
  { to: '/recipes', label: 'Recipes', icon: IconChefHat, permission: 'recipe.view' },
  { to: '/production', label: 'Production', icon: IconBuildingFactory2, permission: 'production.view' },
  // Costing is nothing but an analysis of production orders, so a role that
  // can cost but cannot see production has nothing to look at here.
  { to: '/costing', label: 'Costing', icon: IconChartHistogram, requires: ['costing.view', 'production.view'] },

  { section: 'Supply chain' },
  { to: '/procurement', label: 'Procurement', icon: IconShoppingCart, permission: 'po.view' },
  { to: '/materials', label: 'Materials', icon: IconCookie, permission: 'material.view' },
  { to: '/inventory', label: 'Inventory', icon: IconPackages, permission: 'inventory.view' },

  { section: 'Commercial' },
  { to: '/invoices', label: 'Sales & Purchases', icon: IconFileInvoice, permission: 'sales.view' },
  { to: '/parties', label: 'Customers & Suppliers', icon: IconUsersGroup, permission: 'party.view' },

  { section: 'Finance' },
  { to: '/accounts', label: 'Accounts / GL', icon: IconCash, permission: 'gl.view' },
  { to: '/tax', label: 'Tax', icon: IconReceiptTax, permission: 'tax.view' },
  { to: '/reports', label: 'Reports', icon: IconClipboardList, permission: 'report.view' },

  { section: 'Administration' },
  { to: '/users', label: 'Users & Roles', icon: IconUserCog, permission: 'user.view' },
  { to: '/settings', label: 'Settings', icon: IconSettings, permission: 'settings.view' },
];

function useLenisScroll(targetRef) {
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;

    const lenis = new Lenis({
      wrapper: el,
      content: el.firstElementChild || el,
      duration: 1.05,
      easing: (t) => Math.min(1, 1.001 - 2 ** (-10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.6,
    });

    let frame;
    const raf = (time) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [targetRef]);
}

export function AppLayout() {
  const [opened, { toggle, close }] = useDisclosure();
  const { user, logout, can, canAll } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const [progress, setProgress] = useState(0);

  useLenisScroll(scrollRef);

  useEffect(() => {
    close();
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname, close]);

  const onScrollPositionChange = ({ y }) => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(100, (y / max) * 100) : 0);
  };

  const initials = (user?.name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <AppShell
      header={{ height: 62 }}
      navbar={{ width: 258, breakpoint: 'md', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header
        style={{
          backdropFilter: 'blur(12px)',
          background: scheme === 'dark' ? 'rgba(26,27,30,0.86)' : 'rgba(255,255,255,0.86)',
        }}
      >
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="md" size="sm" />
            <Group
              gap={10}
              wrap="nowrap"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/')}
            >
              <motion.div
                animate={{ rotate: [0, -8, 8, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 5 }}
                style={{ fontSize: 24, lineHeight: 1 }}
              >
                🍪
              </motion.div>
              <div>
                <Text fw={800} size="sm" style={{ letterSpacing: '-0.01em' }}>
                  Biscuit Manufacturing ERP
                </Text>
                <Text size="10px" c="dimmed" visibleFrom="sm">
                  Recipe · Production · Costing · Accounts · Tax
                </Text>
              </div>
            </Group>
          </Group>

          <Group gap="xs" wrap="nowrap">
            <Tooltip label={scheme === 'dark' ? 'Light mode' : 'Dark mode'}>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
                aria-label="Toggle colour scheme"
              >
                {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
              </ActionIcon>
            </Tooltip>

            <Menu shadow="lg" width={228} position="bottom-end" withinPortal>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap={8} wrap="nowrap">
                    <Avatar color="biscuit" radius="xl" size={32}>
                      {initials}
                    </Avatar>
                    <Box visibleFrom="sm">
                      <Text size="xs" fw={700} lh={1.2}>
                        {user?.name}
                      </Text>
                      <Text size="10px" c="dimmed" lh={1.2}>
                        {user?.roleLabel}
                      </Text>
                    </Box>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{user?.email}</Menu.Label>
                <Menu.Item leftSection={<IconSettings size={15} />} onClick={() => navigate('/settings')}>
                  Settings
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconLogout size={15} />} onClick={logout}>
                  Sign out
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Group>
        </Group>

        {/* reading-progress bar */}
        <Box
          style={{
            height: 2,
            width: progress + '%',
            background: 'var(--mantine-color-biscuit-6)',
            transition: 'width 120ms linear',
          }}
        />
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <AppShell.Section grow component={ScrollArea} type="scroll">
          {NAV.map((item, i) => {
            if (item.section) {
              /*
               * Draw a heading only if the user can reach something beneath
               * it. Most roles cannot see every group, and an empty
               * "Commercial" sitting directly on top of "Finance" reads as a
               * missing menu rather than a hidden one.
               */
              const until = NAV.slice(i + 1);
              const end = until.findIndex((n) => n.section);
              const members = end === -1 ? until : until.slice(0, end);
              const visible = members.some((n) =>
                n.requires ? canAll(n.requires) : can(n.permission)
              );
              if (!visible) return null;
              return (
                <Text
                  key={'s' + i}
                  size="10px"
                  fw={700}
                  c="dimmed"
                  tt="uppercase"
                  mt={i === 0 ? 4 : 'md'}
                  mb={6}
                  px="xs"
                  style={{ letterSpacing: '0.08em' }}
                >
                  {item.section}
                </Text>
              );
            }
            if (item.requires ? !canAll(item.requires) : !can(item.permission)) return null;
            if (item.external) {
              return (
                <NavLink
                  key={item.href}
                  component="a"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  label={item.label}
                  className="erp-nav-link"
                  leftSection={<item.icon size={18} stroke={1.7} />}
                  style={{ borderRadius: 'var(--mantine-radius-md)', marginBottom: 2 }}
                />
              );
            }
            return (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                end={item.end}
                label={item.label}
                className="erp-nav-link"
                leftSection={<item.icon size={18} stroke={1.7} />}
                style={{ borderRadius: 'var(--mantine-radius-md)', marginBottom: 2 }}
              />
            );
          })}
        </AppShell.Section>

        <AppShell.Section>
          <Divider my="xs" />
          <Group justify="space-between" px="xs" pb={4}>
            <Badge size="xs" variant="dot" color="teal">
              Connected
            </Badge>
            <Text size="10px" c="dimmed">
              v1.0.0
            </Text>
          </Group>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <ScrollArea
          h="calc(100vh - 62px)"
          viewportRef={scrollRef}
          onScrollPositionChange={onScrollPositionChange}
          scrollbarSize={8}
          type="scroll"
        >
          <Box p={{ base: 'sm', sm: 'lg' }} pb={80} maw={1560} mx="auto">
            <AnimatePresence mode="wait">
              <motion.div key={location.pathname}>
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </Box>
        </ScrollArea>
      </AppShell.Main>
    </AppShell>
  );
}
