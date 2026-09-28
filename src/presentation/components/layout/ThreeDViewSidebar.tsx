import React from 'react';
import { Box, ScrollArea, Tabs } from '@mantine/core';
import { Compass, SlidersHorizontal } from 'lucide-react';
import { RightSidebar } from './RightSidebar';
import { useAppTheme } from '../../theme/useAppTheme';

export const ThreeDViewSidebar: React.FC<{ controlsRef: React.Ref<HTMLDivElement> }> = ({ controlsRef }) => {
  const t = useAppTheme();

  return (
    <Tabs
      defaultValue="camera"
      style={{
        width: 320,
        minWidth: 320,
        height: '100%',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: t.bgSidebar,
      }}
    >
      <Tabs.List grow style={{ flexShrink: 0, borderLeft: `1px solid ${t.border}` }}>
        <Tabs.Tab value="camera" leftSection={<Compass size={14} />}>Ракурс</Tabs.Tab>
        <Tabs.Tab value="properties" leftSection={<SlidersHorizontal size={14} />}>Свойства</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="camera" style={{ flex: 1, minHeight: 0, borderLeft: `1px solid ${t.border}` }}>
        <ScrollArea h="100%" type="auto" offsetScrollbars>
          <Box ref={controlsRef} />
        </ScrollArea>
      </Tabs.Panel>
      <Tabs.Panel value="properties" style={{ flex: 1, minHeight: 0 }}>
        <RightSidebar />
      </Tabs.Panel>
    </Tabs>
  );
};
