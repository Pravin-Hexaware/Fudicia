import React, { useState } from 'react';
import { useLocation, NavLink } from 'react-router-dom';
import { FiLayers, FiChevronLeft, FiFileText, FiSearch, FiBook } from 'react-icons/fi';
import logo from '../assets/FiduciaLogo.png';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { label: 'Dashboard', path: '/', icon: FiLayers },
    { label: 'Mandate Load', path: '/fund-mandate', icon: FiFileText },
    { label: 'Fund Mandate', path: '/sourcing-agent', icon: FiSearch },
  ];

  return (
    <aside
      className={`bg-white border-r border-gray-200 transition-all duration-300 flex flex-col overflow-x-hidden ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className={`p-4 border-b border-gray-200 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <img 
            src={logo} 
            alt="Logo" 
            className={`transition-all duration-200 ${collapsed ? 'h-12 w-22' : 'h-14 w-18'}`}
          />
          {!collapsed && <h2 className="font-bold text-lg text-gray-900">Fudicia</h2>}
        </button>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 hover:bg-gray-100 rounded-md transition-colors"
            title="Collapse"
          >
            <FiChevronLeft size={18} />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;

          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center ${
                collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-3'
              } py-2 rounded-md transition-colors ${
                isActive
                  ? 'bg-indigo-100 text-indigo-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-100'
              }`}
              title={collapsed ? item.label : ''}
            >
              <Icon size={20} className="shrink-0 w-5 h-5" />
              {!collapsed && <span className="text-sm">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;
